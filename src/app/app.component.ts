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

	@ViewChild('visualization') visualization: HTMLElement;
	chart: uPlot;
	data = new Map<string, { index: number, quorum: number, added: number }>();
	chartUpdateInterval;
	clearDataInterval;
	fps = 24;

	confirmations = 0;
	blocks = 0;
	stoppedElections = 0;
	cps = '0';
	startTime = new Date();
	currentTime = new Date();

	latestConfirmations: ConfirmationMessage[] = [];

	constructor(private ws: NanoWebsocketService,
				private changeDetectorRef: ChangeDetectorRef) {
	}

	ngOnDestroy() {
		this.stopInterval();
		if (this.clearDataInterval) {
			clearInterval(this.clearDataInterval);
		}
	}

	async ngOnInit() {
		this.build();
		(await this.ws.subscribeToVotes()).subscribe(async vote => {
			const block = vote.message.blocks[0];
			const principalWeight = this.ws.principalWeights.get(vote.message.account);
			const principalWeightPercent = principalWeight / this.ws.quorumDelta * 100;

			let item = this.data.get(block);
			if (item) {
				item.quorum = item.quorum + principalWeightPercent;
				if (item.quorum >= 100) {
					this.deleteFromData(block);
				}
			} else {
				this.data.set(block, { index: this.blocks++, quorum: principalWeightPercent, added: new Date().getTime() });
			}
		});
		(await this.ws.subscribeToConfirmations()).subscribe(async confirmation => {
			const block = confirmation.message.election_info.blocks[0];
			this.deleteFromData(block);
			this.confirmations++;

			const nanoAmount = Number(tools.convert(confirmation.message.amount, 'RAW', 'NANO')).toFixed(8);
			const trailingZeroesCleared = String(+nanoAmount / 1);
			confirmation.message.amount = trailingZeroesCleared;
			this.latestConfirmations.unshift(confirmation.message);
			if (this.latestConfirmations.length > 20) {
				this.latestConfirmations.shift();
			}
		});
		(await this.ws.subscribeToStoppedElections()).subscribe(async stoppedElection => {
			const block = stoppedElection.message.hash;
			this.deleteFromData(block);
		});
		this.startClearDataInterval();
	}

	async deleteFromData(block: string) {
		if (this.data.delete(block)) {
			this.stoppedElections++;
		}
	}

	async build() {
		const bars = uPlot.paths.bars({ align: 1, size: [1, 100] });
		const opts: uPlot.Options = {
			title: '',
			id: '1',
			class: 'chart',
			width: window.innerWidth,
			height: 600,
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
					fill: 'rgba(255, 0, 0, 0.6)',
					width: 1 / devicePixelRatio,
					max: 100,
				},
			],
		};

		this.chart = new uPlot(opts, [[], []], document.getElementById('visualization'));
		this.startInterval();
	}

	changeFps(e: any) {
		this.fps = e.target.value;
		this.startInterval();
	}

	async startInterval() {
		this.stopInterval();

		if (this.fps == 0) {
			return;
		}

		this.chartUpdateInterval = setInterval(async () => {
			if (this.data.size > 0) {
				const x = [];
				const y = [];
				Array.from(this.data.values()).forEach(i => {
					x.push(i.index);
					y.push(i.quorum);
				});
				this.chart.setData([x, y]);

				const elapsedTimeInSeconds = (new Date().getTime() - this.startTime.getTime()) / 1000;
				this.cps = (this.confirmations / elapsedTimeInSeconds).toFixed(4);

				this.changeDetectorRef.markForCheck();
			}
		}, 1000 / this.fps);
	}

	stopInterval() {
		if (this.chartUpdateInterval) {
			clearInterval(this.chartUpdateInterval);
			this.chartUpdateInterval = undefined;
		}
	}

	startClearDataInterval() {
		this.clearDataInterval = setInterval(() => {
			const toDelete = [];
			const tooOld = new Date().getTime() - (1000 * 60 * 10); // Ten minutes
			for (const [key, value] of this.data.entries()) {
				if (tooOld > value.added) {
					toDelete.push(key);
				}
			}
			toDelete.forEach(key => this.data.delete(key));
		}, 1000 * 5);
	}

}
