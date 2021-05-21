import uPlot from 'uplot';

import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, ViewChild } from '@angular/core';

import { NanoWebsocketService } from './ws.service';

@Component({
	selector: 'app-root',
	templateUrl: './app.component.html',
	styleUrls: ['./app.component.sass'],
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit, OnDestroy {

	@ViewChild('visualization')
	visualization: HTMLElement;

	data = new Map<number, number>();
	recentlyRemoved = new Set<string>();

	interval;

	indexing = new Map<string, number>();
	index = 0;
	nextIndex = () => {
		return this.index++;
	}

	constructor(private ws: NanoWebsocketService) {
	}

	ngOnDestroy() {
		clearInterval(this.interval);
	}

	async ngOnInit() {
		this.build();
		(await this.ws.subscribeToVotes()).subscribe(vote => {
			const block = vote.message.blocks[0];

			if (this.recentlyRemoved.has(block)) {
				return;
			}

			const principalWeight = this.ws.principalWeights.get(vote.message.account);
			const principalWeightPercent = principalWeight / this.ws.confirmationQuorum * 100;

			let index = this.indexing.get(block);
			let previous;
			if (index) {
				previous = this.data.get(index);
			} else {
				index = this.nextIndex();
			}

			if (previous) {
				const newQuorum = previous + principalWeightPercent;
				if (newQuorum < 100) {
					this.data.set(index, previous + principalWeightPercent);
				} else {
					this.deleteFromData(index, block);
				}
			} else {
				this.data.set(index, principalWeightPercent);
				this.indexing.set(block, index);
			}
		});
		(await this.ws.subscribeToConfirmations()).subscribe(confirmation => {
			const block = confirmation.message.election_info.blocks[0];
			const index = this.indexing.get(block);
			this.deleteFromData(index, block);
		});
		(await this.ws.subscribeToStoppedElections()).subscribe(stoppedElection => {
			const block = stoppedElection.message.hash;
			const index = this.indexing.get(block);
			this.deleteFromData(index, block);
		});
	}

	deleteFromData(index: number, block: string) {
		this.data.set(index, null);
		this.indexing.delete(block);
		this.recentlyRemoved.add(block);
		setTimeout(() => {
			this.recentlyRemoved.delete(block);
		}, 1000);
	}

	build() {
		const bars = uPlot.paths.bars({ align: 1, size: [1, Infinity] });
		const opts: uPlot.Options = {
			title: '',
			id: '1',
			class: 'chart',
			width: window.innerWidth,
			height: 600,
			cursor: {
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
				}
			],
			series: [
				{},
				{
					label: 'Quorum',
					paths: bars,
					pxAlign: true,
					points: {
						show: false
					},
					fill: 'rgba(255, 0, 0, 0.6)',
					width: 1 / devicePixelRatio,
					value: (self, rawValue, seriesIdx, idx) => rawValue ? rawValue.toFixed(2) + ' %' : '--',
					max: 100,
				},
			]
		};

		const chart = new uPlot(opts, [[], []], document.body);
		this.interval = setInterval(() => {
			if (this.data.size > 0) {
				const x = Array.from(this.data.keys());
				const y = Array.from(this.data.values());
				chart.setData([x, y]);
			}
		}, 16.7);
	}

}
