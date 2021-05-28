import { tools } from 'nanocurrency-web';
import { environment } from 'src/environments/environment';
import uPlot from 'uplot';

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';

import { Util } from './util';
import { ConfirmationMessage, NanoWebsocketService } from './ws.service';

@Component({
	selector: 'app-root',
	templateUrl: './app.component.html',
	styleUrls: ['./app.component.sass'],
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {

	downArrow = faChevronDown;
	upArrow = faChevronUp;

	pageUpdateInterval: any;
	upkeepInterval: any;
	wsHealthCheckInterval: any;
	animationInterval: any;

	electionChart: uPlot;
	electionChartRecentlyRemoved = new Set<string>();

	blockToIndex = new Map<string, number>();
	indexToAnimating = new Map<number, number>();
	new = [[], [], []];	// Index, Added, quorum

	latestConfirmations: ConfirmationMessage[] = [];
	representativeStats = new Map<string, RepsetentativeStatItem>();

	// User defined settings
	fps: number;
	timeframe: number;
	graphStyle: GraphStyle = 2;

	// Counters
	blocks = 0;
	stoppedElections = 0;
	confirmations = 0;
	cps = '0';
	smooth = true;
	useMaxFPS = true;

	startTime = this.getTimeInSeconds();
	showSettings = false;
	minIndex = 0;

	readonly network = environment.network;
	readonly maxTimeframe = 10;
	readonly maxFps = 60;
	readonly hostAccount = environment.hostAccount;
	readonly explorerUrl = environment.explorerUrl;
	readonly repInfoUrl = environment.repInfoUrl;

	constructor(private ws: NanoWebsocketService,
				private changeDetectorRef: ChangeDetectorRef) {
	}

	ngOnDestroy() {
		this.stopInterval();
		if (this.upkeepInterval) {
			clearInterval(this.upkeepInterval);
		}
		if (this.wsHealthCheckInterval) {
			clearInterval(this.wsHealthCheckInterval);
		}
		if (this.animationInterval) {
			clearInterval(this.animationInterval);
		}
	}

	async ngOnInit() {
		this.startUpkeepInterval();
		this.startAnimationInterval();
		this.initSettings();
		this.buildElectionChart();
		this.startInterval();
		await this.ws.updatePrincipalsAndQuorum();
		this.initPrincipals();
		this.start();
	}

	initSettings() {
		this.fps = Math.min(+localStorage.getItem('nv-fps') || 8, this.maxFps);
		this.timeframe = Math.min(+localStorage.getItem('nv-timeframe') || 1, this.maxTimeframe);
		this.graphStyle = +localStorage.getItem('nv-style') || GraphStyle.HEATMAP;
		this.smooth = (localStorage.getItem('nv-smooth') || 'true') == 'true';
		this.useMaxFPS = (localStorage.getItem('nv-max-fps') || 'true') == 'true';
	}

	initPrincipals() {
		this.ws.principals.forEach(principal => {
			let alias = principal.alias;
			if (principal.account == this.hostAccount) {
				alias = '*** ' + alias;
			}

			this.representativeStats.set(principal.account, {
				weight: this.ws.principalWeights.get(principal.account) / this.ws.onlineStake,
				alias,
				voteCount: 0,
			});
		});
	}

	getTimeInSeconds(date?: Date): number {
		if (!date) {
			date = new Date();
		}
		return date.getTime() / 1000;
	}

	async start() {
		const subjects = await this.ws.subscribe();
		this.wsHealthCheckInterval = setInterval(() => this.ws.checkAndReconnectSocket(), 2000);

		subjects.votes.subscribe(async vote => {
			const block = vote.message.blocks[0];
			const index = this.blockToIndex.get(block);
			const principalWeight = this.ws.principalWeights.get(vote.message.account);
			const principalWeightPercent = principalWeight / this.ws.onlineStake * 100;
			const principalWeightOfQuorum = principalWeightPercent / this.ws.quorumPercent * 100;

			if (index) {
				if (this.new[DataIndex.QUORUM][index] != 0) {
					const previousQuorum = this.new[DataIndex.QUORUM][index];
					const newQuorum = previousQuorum + principalWeightOfQuorum;

					if (newQuorum > 100) {
						if (this.smooth) {
							this.indexToAnimating.set(index, 100 - previousQuorum);
						} else {
							this.new[DataIndex.QUORUM][index] = 100;
							this.indexToAnimating.delete(index);
						}
					} else {
						if (this.smooth) {
							const previous = this.indexToAnimating.get(index);
							let newAnimating;
							if (previous) {
								newAnimating = previous + principalWeightOfQuorum;
							} else {
								newAnimating = principalWeightOfQuorum;
							}

							this.indexToAnimating.set(index, newAnimating);
						} else {
							this.new[DataIndex.QUORUM][index] += principalWeightOfQuorum;
						}
					}
				} else if (!this.electionChartRecentlyRemoved.has(block)) {
					this.addNewBlock(block, principalWeightOfQuorum);
				}
			} else {
				this.addNewBlock(block, principalWeightOfQuorum);
			}

			this.representativeStats.get(vote.message.account).voteCount++;
		});

		subjects.confirmations.subscribe(async confirmation => {
			const block = confirmation.message.hash;
			const index = this.blockToIndex.get(block);

			if (index) {
				if (this.smooth) {
					this.indexToAnimating.set(index, 100 - this.new[DataIndex.QUORUM][index]);
				} else {
					this.new[DataIndex.QUORUM][index] = 100;
				}
			} else {
				this.addNewBlock(block, 100);
			}
			this.confirmations++;

			const nanoAmount = Number(tools.convert(confirmation.message.amount, 'RAW', 'NANO')).toFixed(8);
			const trailingZeroesCleared = String(+nanoAmount / 1);
			confirmation.message.amount = trailingZeroesCleared;
			if (this.latestConfirmations.unshift(confirmation.message) > 20) {
				this.latestConfirmations.pop();
			}
		});

		subjects.stoppedElections.subscribe(async stoppedElection => {
			const block = stoppedElection.message.hash;
			const index = this.blockToIndex.get(block);
			if (index && this.new[DataIndex.QUORUM][index] != 0 && this.new[DataIndex.QUORUM][index] < 100) {
				this.new[DataIndex.QUORUM][index] = 0;
				this.indexToAnimating.delete(index);
				this.stoppedElections++;
				this.electionChartRecentlyRemoved.add(block);
				setTimeout(() => this.electionChartRecentlyRemoved.delete(block), 2000);
			}
		});
	}

	addNewBlock(block, quorum) {
		const index = this.blocks++;
		const added = this.getTimeInSeconds();
		this.blockToIndex.set(block, index);

		if (this.smooth) {
			this.new[DataIndex.INDEX][index] = index;
			this.new[DataIndex.ADDED][index] = added;
			this.new[DataIndex.QUORUM][index] = 0;
			this.indexToAnimating.set(index, quorum);
		} else {
			this.new[DataIndex.INDEX][index] = index;
			this.new[DataIndex.ADDED][index] = added;
			this.new[DataIndex.QUORUM][index] = quorum;
		}
	}

	async buildElectionChart() {
		const series = this.graphStyle == GraphStyle.LINES ? {
			label: 'Quorum %',
			paths: uPlot.paths.bars({ align: 1, size: [1, 20] }),
			pxAlign: 0,
			spanGaps: false,
			points: {
				show: false,
			},
			fill: 'rgba(74, 144, 226, 1)',
			width: 1 / devicePixelRatio,
			max: 100,
		} : {
			paths: () => null,
			points: {
				show: false,
			},
		};

		const opts: uPlot.Options = {
			title: '',
			id: '1',
			class: 'chart',
			width: window.innerWidth - 17,
			height: 600,
			padding: [20, 10, 0, -10],
			pxAlign: 0,
			cursor: {
				show: false,
			},
			scales: {
				'x': {
					time: true,
					range: (u, dataMin, dataMax) => {
						if (this.graphStyle == GraphStyle.LINES) {
							return [dataMin, dataMax];
						} else {
							return [dataMin, this.getTimeInSeconds() - 0.05];
						}
					},
				},
				'y': {
					range: (u, dataMin, dataMax) => [0, 100],
					auto: false,
				}
			},
			axes: [
				{
					stroke: '#c7d0d9',
					grid: {
						width: 1 / devicePixelRatio,
						stroke: "#2c3235",
					},
				}, {
					stroke: '#c7d0d9',
					grid: {
						width: 1 / devicePixelRatio,
						stroke: "#2c3235",
					},
				},
			],
			series: [
				{
					points: {
						show: false,
					},
				},
				series,
			],
			hooks: {
				draw: [(u: uPlot) => {
					if (this.graphStyle == GraphStyle.HEATMAP) {
						const { ctx, data } = u;
						let yData = data[1];

						ctx.beginPath();
						ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
						ctx.clip();

						yData.forEach((yVal, xi) => {
							let xPos = Math.round(u.valToPos(data[0][xi], 'x', true));
							let yPos = Math.round(u.valToPos(yVal, 'y', true));
							const green = 255 * (yVal / 100);
							const red = 150 - yVal || 0;
							ctx.fillStyle = `rgba(${red}, ${green}, 0, 0.5)`;
							ctx.fillRect(
								xPos,
								yPos,
								5,
								5,
							);
						});
					}
				}]
			}
		};

		const chartElement = document.getElementById('electionChart');
		chartElement.innerHTML = '';
		this.electionChart = new uPlot(opts, [[], []], chartElement);
	}

	changeUseMaxFps() {
		this.useMaxFPS = !this.useMaxFPS;
		localStorage.setItem('nv-max-fps', this.useMaxFPS ? 'true' : 'false');
		this.startInterval();
	}

	changeFps(e: any) {
		this.fps = e.target.value;
		this.startInterval();
		localStorage.setItem('nv-fps', String(this.fps));
	}

	changeTimeframe(e: any) {
		this.timeframe = e.target.value;
		localStorage.setItem('nv-timeframe', String(this.timeframe));
	}

	changeGraphStyle(style: GraphStyle) {
		this.graphStyle = style;
		localStorage.setItem('nv-style', String(this.graphStyle));
		this.buildElectionChart();
	}

	changeSmooth() {
		this.smooth = !this.smooth;
		localStorage.setItem('nv-smooth', this.smooth ? 'true' : 'false');
		if (!this.smooth) {
			for (const [index, animating] of this.indexToAnimating.entries()) {
				this.new[DataIndex.QUORUM][index] = Math.min(this.new[DataIndex.QUORUM][index] + animating, 100);
			}
			this.indexToAnimating.clear();
		}
	}

	async startInterval() {
		this.stopInterval();
		if (this.useMaxFPS) {
			const startAnimation = () => {
				this.update();
				this.pageUpdateInterval = requestAnimationFrame(startAnimation);
			}
			startAnimation();
		} else if (this.fps != 0) {
			this.pageUpdateInterval = setInterval(() => {
				this.update();
			}, 1000 / this.fps);
		}
	}

	update() {
		if (this.new.length > 0) {
			const now = this.getTimeInSeconds();
			const tooOld = now - (60 * this.timeframe);
			const lastTooOldIndex = Util.binarySearchNearestIndex(this.new[DataIndex.ADDED], tooOld);
			let x, y;
			if (lastTooOldIndex > 0) {
				x = this.new[DataIndex.ADDED].slice(lastTooOldIndex);
				y = this.new[DataIndex.QUORUM].slice(lastTooOldIndex);
			} else {
				x = this.new[DataIndex.ADDED];
				y = this.new[DataIndex.QUORUM];
			}

			// Fill out the timeline even though new data hasn't come by
			const lastAdded = this.new[DataIndex.ADDED][this.new[DataIndex.INDEX].length - 1];
			if (now > lastAdded) {
				const nextIndex = this.blocks++;
				this.new[DataIndex.INDEX][nextIndex] = nextIndex;
				this.new[DataIndex.ADDED][nextIndex] = now;
				this.new[DataIndex.QUORUM][nextIndex] = null;
			}

			this.electionChart.setData([x, y]);

			const elapsedTimeInSeconds = now - this.startTime;
			this.cps = (this.confirmations / elapsedTimeInSeconds).toFixed(4);

			this.changeDetectorRef.markForCheck();
		}
	}

	startAnimationInterval() {
		const increment = 1.5;
		this.animationInterval = setInterval(() => {
			if (this.smooth && this.new[DataIndex.INDEX].length) {
				const tooOld = this.getTimeInSeconds() - (60 * this.timeframe);
				for (const [index, animating] of this.indexToAnimating.entries()) {
					if (tooOld < this.new[DataIndex.ADDED][index]) {
						if (animating > increment) {
							this.new[DataIndex.QUORUM][index] += increment;
							this.indexToAnimating.set(index, animating - increment);
						} else {
							this.new[DataIndex.QUORUM][index] += animating;
							this.indexToAnimating.delete(index);
						}
						if (this.new[DataIndex.QUORUM][index] > 100) {
							this.new[DataIndex.QUORUM][index] = 100;
						}
					} else {
						this.new[DataIndex.QUORUM][index] += animating;
						this.indexToAnimating.delete(index);
					}
				}
			}
		}, 40);
	}

	stopInterval() {
		if (this.pageUpdateInterval) {
			clearInterval(this.pageUpdateInterval);
			cancelAnimationFrame(this.pageUpdateInterval);
			this.pageUpdateInterval = undefined;
		}
	}

	startUpkeepInterval() {
		this.upkeepInterval = setInterval(async () => {
			console.log('Upkeep triggered...');
			await this.ws.updatePrincipalsAndQuorum();

			const now = this.getTimeInSeconds();
			const tooOld = now - (60 * (this.maxTimeframe + 0.2));
			const lastTooOldIndex = Util.binarySearchNearestIndex(this.new[DataIndex.ADDED], tooOld);
			this.new[DataIndex.INDEX].splice(0, lastTooOldIndex);
			this.new[DataIndex.ADDED].splice(0, lastTooOldIndex);
			this.new[DataIndex.QUORUM].splice(0, lastTooOldIndex);

			for (const principal of this.ws.principals) {
				const stat = this.representativeStats.get(principal.account);
				if (stat) {
					stat.alias = principal.alias;
					stat.weight = this.ws.principalWeights.get(principal.account) / this.ws.onlineStake;
				}
			}
		}, 1000 * 60 * this.maxTimeframe / 2);
	}

}

export interface DataItem {
	index: number;
	quorum: number;
	animatingQuorum: number;
	added: number;
}

export interface RepsetentativeStatItem {
	weight: number;
	alias: string;
	voteCount: number;
}

export enum GraphStyle {
	X0,
	LINES,
	HEATMAP,
}

export enum DataIndex {
	INDEX,
	ADDED,
	QUORUM,
}
