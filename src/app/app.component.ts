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

	electionChart: any;

	// Icons
	downArrow = faChevronDown;
	upArrow = faChevronUp;

	// Intervals
	pageUpdateInterval: any;
	upkeepInterval: any;
	wsHealthCheckInterval: any;

	// Data handling
	readonly data: ElectionChartData[] = [];
	readonly blockToIndex = new Map<string, number>();
	readonly indexToAnimating = new Map<number, number>();
	readonly repToBlocks = new Map<string, Set<string>>();
	readonly latestConfirmations: ConfirmationMessage[] = [];
	readonly representativeStats = new Map<string, RepsetentativeStatItem>();
	readonly electionChartRecentlyRemoved = new Set<string>();
	readonly startTime = new Date().getTime() / 1000;

	// User defined settings
	fps: number;
	timeframe: number;
	graphStyle: GraphStyle = 2;
	smooth = true;
	useMaxFPS = true;
	showSettings = false;

	// Counters
	index = 0;
	blocks = 0;
	stoppedElections = 0;
	confirmations = 0;
	cps = '0';

	// Environment settings
	readonly network = environment.network;
	readonly maxTimeframeMinutes = 10;
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
	}

	async ngOnInit() {
		this.startUpkeepInterval();
		this.initSettings();
		this.buildElectionChart();
		this.startInterval();
		await this.ws.updatePrincipalsAndQuorum();
		this.initPrincipals();
		this.start();
	}

	initSettings() {
		this.fps = Math.min(+localStorage.getItem('nv-fps') || 24, this.maxFps);
		this.timeframe = Math.min(+localStorage.getItem('nv-timeframe') || 5, this.maxTimeframeMinutes);
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

			this.repToBlocks.set(principal.account, new Set());
			this.representativeStats.set(principal.account, {
				weight: this.ws.principalWeights.get(principal.account) / this.ws.onlineStake,
				alias,
				voteCount: 0,
			});
		});
	}

	getRelativeTimeInSeconds(): number {
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

			const item = this.data[index];

			// The node is reporting representative votes which are already counted, only count first occurrences
			const blocks = this.repToBlocks.get(vote.message.account);
			if (!blocks.has(vote.message.blocks[0])) {
				if (index && item) {
					const previousQuorum = item.quorum;
					const newQuorum = previousQuorum + principalWeightOfQuorum;

					if (item.quorum != 100) {
						if (newQuorum >= 100) {
							if (this.smooth) {
								this.indexToAnimating.set(index, 100 - previousQuorum);
							} else {
								item.quorum = 100;
								this.indexToAnimating.delete(index);
							}
						} else {
							if (this.smooth) {
								const previousAnimating = this.indexToAnimating.get(index);
								let newAnimating = principalWeightOfQuorum;
								if (previousAnimating) {
									newAnimating = Math.max(previousAnimating + principalWeightOfQuorum, 100);
									if (newAnimating + item.quorum > 100) {
										newAnimating = 100 - item.quorum;
									}
								}
								this.indexToAnimating.set(index, newAnimating);
							} else {
								item.quorum = Math.max(item.quorum + principalWeightOfQuorum, 100);
							}
						}
					}
				} else if (!this.electionChartRecentlyRemoved.has(block)) {
					this.addNewBlock(block, principalWeightOfQuorum);
				}

				blocks.add(vote.message.blocks[0]);
				this.representativeStats.get(vote.message.account).voteCount++;
			}
		});

		subjects.confirmations.subscribe(async confirmation => {
			const block = confirmation.message.hash;
			const index = this.blockToIndex.get(block);
			const item = this.data[index];
			if (index && item) {
				if (this.smooth && !isNaN(item.quorum)) {
					this.indexToAnimating.set(index, 100 - item.quorum);
				} else {
					item.quorum = 100;
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
			const item = this.data[index];
			if (item?.quorum < 100) {
				item.quorum = null;
				this.stoppedElections++;
				this.electionChartRecentlyRemoved.add(block);
				setTimeout(() => this.electionChartRecentlyRemoved.delete(block), 500);
			}

			this.blockToIndex.delete(block);
			this.indexToAnimating.delete(index);
		});
	}

	addNewBlock(block: string, quorum: number) {
		const previousIndex = this.blockToIndex.get(block);
		if (previousIndex) {
			return;
		}

		const index = this.index++;
		const added = this.getRelativeTimeInSeconds();
		this.blockToIndex.set(block, index);

		if (this.smooth) {
			this.data[index] = {
				added: added,
				quorum: 0,
			};
			this.indexToAnimating.set(index, quorum);
		} else {
			this.data[index] = {
				added: added,
				quorum,
			};
		}

		this.blocks++;
	}

	async buildElectionChart() {
		const xScale = d3.scaleLinear().domain([0, 1000]);
		const yScale = d3.scaleLinear().domain([0, 101]);

		const yearColorScale = d3
				.scaleSequential()
				.domain([0, 100])
				.interpolator(d3.interpolateRdYlGn);

		const webglColor = (color: string) => {
			if (color) {
				const { r, g, b, opacity } = d3.color(color).rgb();
				return [r / 255, g / 255, b / 255, opacity];
			} else {
				return [0, 0, 0, 0];
			}
		}

		const fillColor = (<any>fc)
				.webglFillColor()
				.value((item: ElectionChartData) => webglColor(yearColorScale(item?.quorum)))
				.data(this.data);

		this.electionChart = document.querySelector('d3fc-canvas');
		const series = (<any>fc)
				.seriesWebglPoint()
				.xScale(xScale)
				.yScale(yScale)
				.size(10)
				.crossValue((item: ElectionChartData) => item?.added)
				.mainValue((item: ElectionChartData) => item?.quorum)
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

					const now = this.getRelativeTimeInSeconds();
					const start = now - (60 * this.timeframe);

					// Handle animation
					if (this.smooth) {
						for (const [index, animating] of this.indexToAnimating.entries()) {
							// Delete the queued animation if the target is no longer present
							const item = this.data[index];
							if (!item || isNaN(animating) || item.quorum == 100) {
								this.indexToAnimating.delete(index);
								continue;
							}

							// Animate only the ones which are currently rendered, just increment the quorum of others
							if (start < item.added) {
								// Interpolate linear increments down to a minimum increment of 0.13 to save resources
								const increment = Math.max(Util.lerp(0, item.quorum + animating, animating / (item.quorum + animating) / 20), 0.1);

								// If the increment is smaller than the remainder animation, keep animating
								// Else add the rest of remaining animation. Cap quorum at 100
								if (animating > increment) {
									item.quorum = Math.min(item.quorum + increment, 100);
									this.indexToAnimating.set(index, animating - increment);
								} else {
									item.quorum = Math.min(item.quorum + animating, 100);
									this.indexToAnimating.delete(index);
								}
							} else {
								item.quorum = Math.min(item.quorum + animating, 100);
								this.indexToAnimating.delete(index);
							}
						}
					}

					// Fill out the timeline even though new data hasn't come by
					const lastAdded = this.data[this.data.length - 1].added;
					if (now > lastAdded) {
						const nextIndex = this.index++;
						this.data[nextIndex] = {
							added: now,
							quorum: null,
						};
					}

					// Binary search the nearest index to the current minimum displayed area
					const lastTooOldIndex = Util.binarySearchNearestIndex(this.data, 'added', start);
					let displayedData;
					if (lastTooOldIndex > 0) {
						displayedData = this.data.slice(lastTooOldIndex);
					} else {
						displayedData = this.data;
					}

					// Set data to color function and chart
					fillColor.data(displayedData);
					series(displayedData);

					// Set the displayed area to be from start time to current time
					xScale.domain([ Math.max(start, 0), now ]);

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
			this.clearAnimatingQueue();
		}
	}

	clearAnimatingQueue() {
		for (const [index, animating] of this.indexToAnimating.entries()) {
			const item = this.data[index];
			if (item) {
				item.quorum = Math.min(item.quorum + animating, 100);
			}
		}
		this.indexToAnimating.clear();
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
			const now = this.getRelativeTimeInSeconds();
			this.cps = (this.confirmations / now).toFixed(4);
			this.electionChart.requestRedraw();
			this.changeDetectorRef.markForCheck();
		}
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

			const now = this.getRelativeTimeInSeconds();
			const tooOld = Math.max(now - (60 * this.maxTimeframeMinutes), 0);
			let lastTooOldIndex = 0;
			for (let i = 0; i < this.data.length; i++) {
				const item = this.data[i];
				if (item && tooOld > item?.added) {
					delete this.data[i];
					lastTooOldIndex = i;
				}
			}

			for (const index of this.indexToAnimating.keys()) {
				if (index < lastTooOldIndex) {
					this.indexToAnimating.delete(index);
				}
			}

			for (const principal of this.ws.principals) {
				const stat = this.representativeStats.get(principal.account);
				if (stat) {
					stat.alias = principal.alias;
					stat.weight = this.ws.principalWeights.get(principal.account) / this.ws.onlineStake;
				}
			}
		}, 1000 * 60 * this.maxTimeframeMinutes);
	}

}

export interface ElectionChartData {
	added: number;
	quorum: number;
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
