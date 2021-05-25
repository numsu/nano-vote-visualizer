import { tools } from 'nanocurrency-web';
import uPlot from 'uplot';

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { ConfirmationMessage, NanoWebsocketService } from './ws.service';

@Component({
	selector: 'app-root',
	templateUrl: './app.component.html',
	styleUrls: ['./app.component.sass'],
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {

	pageUpdateInterval: any;
	upkeepInterval: any;
	wsHealthCheckInterval: any;

	electionChart: uPlot;
	electionChartData = new Map<string, DataItem>();
	electionChartRecentlyRemoved = new Set<string>();

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

	startTime = new Date();
	showSettings = false;

	readonly maxTimeframe = 10;
	readonly maxFps = 60;
	readonly hostAccount = 'nano_3zapp5z141qpjipsb1jnjdmk49jwqy58i6u6wnyrh6x7woajeyme85shxewt';

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
		this.fps = Math.min(+localStorage.getItem('nv-fps') || 8, this.maxFps);
		this.timeframe = Math.min(+localStorage.getItem('nv-timeframe') || 1, this.maxTimeframe);
		this.graphStyle = +localStorage.getItem('nv-style') || GraphStyle.HEATMAP;
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

	async start() {
		const subjects = await this.ws.subscribe();
		this.wsHealthCheckInterval = setInterval(() => this.ws.checkAndReconnectSocket(), 5000);

		subjects.votes.subscribe(async vote => {
			const block = vote.message.blocks[0];
			const principalWeight = this.ws.principalWeights.get(vote.message.account);
			const principalWeightPercent = principalWeight / this.ws.onlineStake * 100;
			const principalWeightOfQuorum = principalWeightPercent / this.ws.quorumPercent * 100;

			const item = this.electionChartData.get(block);
			if (item) {
				if (item.quorum != null) {
					item.quorum = item.quorum + principalWeightOfQuorum;
					if (item.quorum > 100) {
						item.quorum = 100;
					}
				} else if (!this.electionChartRecentlyRemoved.has(block)) {
					this.electionChartData.delete(block);
					this.electionChartData.set(block, { index: this.blocks++, quorum: principalWeightOfQuorum, added: new Date().getTime() });
				}
			} else {
				this.electionChartData.set(block, { index: this.blocks++, quorum: principalWeightOfQuorum, added: new Date().getTime() });
			}

			this.representativeStats.get(vote.message.account).voteCount++;
		});

		subjects.confirmations.subscribe(async confirmation => {
			const block = confirmation.message.hash;
			const item = this.electionChartData.get(block);
			if (item) {
				item.quorum = 100;
			} else {
				this.electionChartData.set(block, { index: this.blocks++, quorum: 100, added: new Date().getTime() });
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
			const item = this.electionChartData.get(block);
			if (item && item.quorum != null && item.quorum < 100) {
				item.quorum = null;
				this.stoppedElections++;
				this.electionChartRecentlyRemoved.add(block);
				setTimeout(() => this.electionChartRecentlyRemoved.delete(block), 2000);
			}
		});
	}

	async buildElectionChart() {
		const chartElement = document.getElementById('electionChart');
		chartElement.innerHTML = '';

		const paths = this.graphStyle == GraphStyle.LINES
				? uPlot.paths.bars({ align: 1, size: [1, 20] })
				: () => null;
		const xRange: uPlot.Scale.Range = this.graphStyle == GraphStyle.LINES
				? (u, dataMin, dataMax) => {
					return [dataMin, dataMax];
				}
				: (u, dataMin, dataMax) => {
					return [0, dataMax];
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
					time: false,
					range: xRange,
				},
				'y': {
					range: (u, dataMin, dataMax) => [0, 100],
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
				{},
				{
					label: 'Quorum %',
					paths,
					pxAlign: 0,
					spanGaps: false,
					points: {
						show: false,
					},
					fill: 'rgba(74, 144, 226, 1)',
					width: 1 / devicePixelRatio,
					max: 100,
				},
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

		this.electionChart = new uPlot(opts, [[], []], chartElement);
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

	async startInterval() {
		this.stopInterval();

		if (this.fps == 0) {
			return;
		}

		this.pageUpdateInterval = setInterval(async () => {
			if (this.electionChartData.size > 0) {
				const x = [];
				const y = [];
				const now = new Date().getTime();
				const tooOld = now - (1000 * 60 * this.timeframe);
				Array.from(this.electionChartData.values()).forEach(i => {
					if (tooOld < i.added) {
						x.push(i.index);
						y.push(i.quorum);
					}
				});
				this.electionChart.setData([x, y]);

				const elapsedTimeInSeconds = (now - this.startTime.getTime()) / 1000;
				this.cps = (this.confirmations / elapsedTimeInSeconds).toFixed(4);

				this.changeDetectorRef.markForCheck();
			}
		}, 1000 / this.fps);
	}

	stopInterval() {
		if (this.pageUpdateInterval) {
			clearInterval(this.pageUpdateInterval);
			this.pageUpdateInterval = undefined;
		}
	}

	startUpkeepInterval() {
		this.upkeepInterval = setInterval(async () => {
			console.log('Upkeep triggered...');
			await this.ws.updatePrincipalsAndQuorum();

			const toDeleteBlocks = [];
			const now = new Date().getTime();
			const tooOld = now - (1000 * 60 * this.maxTimeframe);
			for (const [key, value] of this.electionChartData.entries()) {
				if (tooOld > value.added) {
					toDeleteBlocks.push(key);
				}
			}

			toDeleteBlocks.forEach(item => this.electionChartData.delete(item));

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