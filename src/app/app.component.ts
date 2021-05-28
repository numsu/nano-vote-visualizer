import * as fc from 'd3fc';
import * as d3 from 'd3';
import { tools } from 'nanocurrency-web';
import { environment } from 'src/environments/environment';

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

	// Icons
	downArrow = faChevronDown;
	upArrow = faChevronUp;

	// Intervals
	pageUpdateInterval: any;
	upkeepInterval: any;
	wsHealthCheckInterval: any;
	animationInterval: any;

	electionChart: any;

	// Data
	blockToIndex = new Map<string, number>();
	indexToAnimating = new Map<number, number>();
	data = [[], []]; // Added, quorum
	latestConfirmations: ConfirmationMessage[] = [];
	representativeStats = new Map<string, RepsetentativeStatItem>();
	electionChartRecentlyRemoved = new Set<string>();

	// User defined settings
	fps: number;
	timeframe: number;
	graphStyle: GraphStyle = 2;

	blocks = 0;
	stoppedElections = 0;
	confirmations = 0;
	cps = '0';
	smooth = true;
	useMaxFPS = true;
	startTime = new Date().getTime() / 1000;
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
		this.fps = Math.min(+localStorage.getItem('nv-fps') || 24, this.maxFps);
		this.timeframe = Math.min(+localStorage.getItem('nv-timeframe') || 5, this.maxTimeframe);
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

	getTimeInSeconds(): number {
		return (new Date().getTime() / 1000) - this.startTime;
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
				if (this.data[DataIndex.QUORUM][index] != 0) {
					const previousQuorum = this.data[DataIndex.QUORUM][index];
					const newQuorum = previousQuorum + principalWeightOfQuorum;

					if (newQuorum > 100) {
						if (this.smooth) {
							this.indexToAnimating.set(index, 100 - previousQuorum);
						} else {
							this.data[DataIndex.QUORUM][index] = 100;
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
							this.data[DataIndex.QUORUM][index] += principalWeightOfQuorum;
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
					this.indexToAnimating.set(index, 100 - this.data[DataIndex.QUORUM][index]);
				} else {
					this.data[DataIndex.QUORUM][index] = 100;
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
			if (index && this.data[DataIndex.QUORUM][index] != 0 && this.data[DataIndex.QUORUM][index] < 100) {
				this.data[DataIndex.QUORUM][index] = 0;
				this.indexToAnimating.delete(index);
				this.stoppedElections++;
				this.electionChartRecentlyRemoved.add(block);
				setTimeout(() => this.electionChartRecentlyRemoved.delete(block), 2000);
			}
		});
	}

	addNewBlock(block: string, quorum: number) {
		const index = this.blocks++;
		const added = this.getTimeInSeconds();
		this.blockToIndex.set(block, index);

		if (this.smooth) {
			this.data[DataIndex.ADDED][index] = added;
			this.data[DataIndex.QUORUM][index] = 0;
			this.indexToAnimating.set(index, quorum);
		} else {
			this.data[DataIndex.ADDED][index] = added;
			this.data[DataIndex.QUORUM][index] = quorum;
		}
	}

	async buildElectionChart() {
		const xScale = d3.scaleLinear().domain([0, 1000]);
		const yScale = d3.scaleLinear().domain([0, 101]);

		const yearColorScale = d3
				.scaleSequential()
				.domain([0, 100])
				.interpolator(d3.interpolateRdYlGn);

		const webglColor = color => {
			if (color) {
				const { r, g, b, opacity } = d3.color(color).rgb();
				return [r / 255, g / 255, b / 255, opacity];
			} else {
				return [0, 0, 0, 0];
			}
		}

		const fillColor = (<any>fc)
				.webglFillColor()
				.value(item => webglColor(yearColorScale(item.y)))
				.data(this.data);

		this.electionChart = document.querySelector('d3fc-canvas');
		const series = (<any>fc)
				.seriesWebglPoint()
				.xScale(xScale)
				.yScale(yScale)
				.size(10)
				.crossValue(data => data.x)
				.mainValue(data => data.y)
				.defined(() => true)
				.equals((_, __) => false)
				.decorate(program => fillColor(program));

		let pixels = null;
		let gl = null;

		d3.select(this.electionChart)
				.on('measure', event => {
					const { width, height } = event.detail;
					xScale.range([0, width]);
					yScale.range([height, 0]);
					gl = this.electionChart.querySelector('canvas').getContext('webgl');
					series.context(gl);
				})
				.on('draw', () => {
					if (pixels == null) {
						pixels = new Uint8Array(
							gl.drawingBufferWidth * gl.drawingBufferHeight * 4
						);
					}

					const now = this.getTimeInSeconds();
					const tooOld = now - (60 * this.timeframe);
					const lastTooOldIndex = Util.binarySearchNearestIndex(this.data[DataIndex.ADDED], tooOld);
					let x, y;
					if (lastTooOldIndex > 0) {
						x = this.data[DataIndex.ADDED].slice(lastTooOldIndex);
						y = this.data[DataIndex.QUORUM].slice(lastTooOldIndex);
					} else {
						x = this.data[DataIndex.ADDED];
						y = this.data[DataIndex.QUORUM];
					}

					// Fill out the timeline even though new data hasn't come by
					const lastAdded = this.data[DataIndex.ADDED][this.data[DataIndex.ADDED].length - 1];
					if (now > lastAdded) {
						const nextIndex = this.blocks++;
						this.data[DataIndex.ADDED][nextIndex] = now;
						this.data[DataIndex.QUORUM][nextIndex] = null;
					}

					const data = [];
					for (let i = 0; i < x.length; i++) {
						data.push({
							x: x[i],
							y: y[i],
						});
					}

					fillColor.data(data);
					series(data);
					xScale.domain([ this.data[DataIndex.ADDED][lastTooOldIndex], this.data[DataIndex.ADDED][this.data[DataIndex.ADDED].length - 1] ]);

					gl.readPixels(
						0,
						0,
						gl.drawingBufferWidth,
						gl.drawingBufferHeight,
						gl.RGBA,
						gl.UNSIGNED_BYTE,
						pixels
					);
				});
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
				this.data[DataIndex.QUORUM][index] = Math.min(this.data[DataIndex.QUORUM][index] + animating, 100);
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
		if (this.data.length > 0) {
			const now = this.getTimeInSeconds();
			this.cps = (this.confirmations / now).toFixed(4);
			this.electionChart.requestRedraw();
			this.changeDetectorRef.markForCheck();
		}
	}

	startAnimationInterval() {
		const increment = 0.8;
		this.animationInterval = setInterval(() => {
			if (this.smooth && this.data[DataIndex.ADDED].length) {
				const tooOld = this.getTimeInSeconds() - (60 * this.timeframe);
				for (const [index, animating] of this.indexToAnimating.entries()) {
					if (tooOld < this.data[DataIndex.ADDED][index]) {
						if (animating > increment) {
							this.data[DataIndex.QUORUM][index] += increment;
							this.indexToAnimating.set(index, animating - increment);
						} else {
							this.data[DataIndex.QUORUM][index] += animating;
							this.indexToAnimating.delete(index);
						}
						if (this.data[DataIndex.QUORUM][index] > 100) {
							this.data[DataIndex.QUORUM][index] = 100;
						}
					} else {
						this.data[DataIndex.QUORUM][index] += animating;
						this.indexToAnimating.delete(index);
					}
				}
			}
		}, 20);
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
			const lastTooOldIndex = Util.binarySearchNearestIndex(this.data[DataIndex.ADDED], tooOld);
			this.data[DataIndex.ADDED].splice(0, lastTooOldIndex);
			this.data[DataIndex.QUORUM].splice(0, lastTooOldIndex);

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

export interface RepsetentativeStatItem {
	weight: number;
	alias: string;
	voteCount: number;
}

export enum GraphStyle {
	X0,
	HEATMAP,
}

export enum DataIndex {
	ADDED,
	QUORUM,
}
