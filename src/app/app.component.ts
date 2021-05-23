import { tools } from 'nanocurrency-web';
import uPlot from 'uplot';

import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';

import { ConfirmationMessage, NanoWebsocketService } from './ws.service';

@Component({
	selector: 'app-root',
	templateUrl: './app.component.html',
	styleUrls: ['./app.component.sass'],
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {

	pageUpdateInterval: any;

	electionChart: uPlot;
	electionChartData = new Map<string, DataItem>();
	electionChartRecentlyRemoved = new Set<string>();

	latestConfirmations: ConfirmationMessage[] = [];
	representativeStats = new Map<string, RepsetentativeStatItem>();

	// User defined settings
	fps: number;
	timeframe: number;

	// Counters
	blocks = 0;
	stoppedElections = 0;
	confirmations = 0;
	cps = '0';

	startTime = new Date();


	constructor(private ws: NanoWebsocketService,
				private changeDetectorRef: ChangeDetectorRef) {
	}

	ngOnDestroy() {
		this.stopInterval();
	}

	async ngOnInit() {
		this.initSettings();
		this.build();
		(await this.ws.subscribeToVotes()).subscribe(async vote => {
			const block = vote.message.blocks[0];
			const principalWeight = this.ws.principalWeights.get(vote.message.account);
			const principalWeightPercent = principalWeight / this.ws.quorumDelta * 100;

			const item = this.electionChartData.get(block);
			if (item) {
				if (item.quorum !== null) {
					item.quorum = item.quorum + principalWeightPercent;
					if (item.quorum > 100) {
						item.quorum = 100;
					}
				} else if (!this.electionChartRecentlyRemoved.has(block)) {
					this.electionChartData.delete(block);
					this.electionChartData.set(block, { index: this.blocks++, quorum: principalWeightPercent, added: new Date().getTime() });
				}
			} else {
				this.electionChartData.set(block, { index: this.blocks++, quorum: principalWeightPercent, added: new Date().getTime() });
			}

			this.representativeStats.get(vote.message.account).voteCount++;
		});
		(await this.ws.subscribeToConfirmations()).subscribe(async confirmation => {
			const block = confirmation.message.hash;
			const item = this.electionChartData.get(block);
			if (item) {
				item.quorum = 100;
			}
			this.confirmations++;

			const nanoAmount = Number(tools.convert(confirmation.message.amount, 'RAW', 'NANO')).toFixed(8);
			const trailingZeroesCleared = String(+nanoAmount / 1);
			confirmation.message.amount = trailingZeroesCleared;
			if (this.latestConfirmations.unshift(confirmation.message) > 20) {
				this.latestConfirmations.pop();
			}
		});
		(await this.ws.subscribeToStoppedElections()).subscribe(async stoppedElection => {
			const block = stoppedElection.message.hash;
			const item = this.electionChartData.get(block);
			if (!item || item.quorum < 100) {
				this.deleteFromData(block, item);
			}
		});

		this.ws.principals.forEach(principal => {
			let alias = principal.alias;
			if (principal.account == 'nano_3zapp5z141qpjipsb1jnjdmk49jwqy58i6u6wnyrh6x7woajeyme85shxewt') {
				alias = '*** ' + alias;
			}

			this.representativeStats.set(principal.account, {
				weight: this.ws.principalWeights.get(principal.account) / this.ws.quorumDelta,
				alias,
				voteCount: 0,
			})
		});
	}

	initSettings() {
		this.fps = +localStorage.getItem('nv-fps') || 8;
		this.timeframe = +localStorage.getItem('nv-timeframe') || 1;
	}

	async deleteFromData(block: string, item: DataItem) {
		if (item && item.quorum !== null) {
			item.quorum = null;
			this.stoppedElections++;
			this.electionChartRecentlyRemoved.add(block);
			setTimeout(() => this.electionChartRecentlyRemoved.delete(block), 2000);
		}
	}

	async build() {
		const bars = uPlot.paths.bars({ align: 1, size: [1, 20] });
		const opts: uPlot.Options = {
			title: '',
			id: '1',
			class: 'chart',
			width: window.innerWidth - 17,
			height: 600,
			padding: [20, 10, 0, -10],
			pxAlign: false,
			cursor: {
				show: false,
			},
			scales: {
				'x': {
					time: false,
				},
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
					paths: bars,
					pxAlign: false,
					spanGaps: false,
					points: {
						show: false,
					},
					fill: 'rgba(74, 144, 226, 1)',
					width: 1 / devicePixelRatio,
					max: 100,
				},
			],
		};

		this.electionChart = new uPlot(opts, [[], []], document.getElementById('electionChart'));
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