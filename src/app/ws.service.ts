import BigNumber from 'bignumber.js'
import { tools } from 'nanocurrency-web';
import { Subject } from 'rxjs';
import { delay, retryWhen, tap } from 'rxjs/operators';
import { WebSocketSubject, webSocket } from 'rxjs/webSocket';

import { HttpClient } from '@angular/common/http';
import { Injectable } from "@angular/core";

@Injectable()
export class NanoWebsocketService {

	wsUrl = 'wss://nanows.numsu.dev';
	rpcUrl = 'https://nanoproxy.numsu.dev/proxy';

	principals: Principal[] = [];
	principalWeights = new Map<string, number>();
	quorumPercent: number;
	onlineStake: number;

	voteSubscription = new Subject<Vote>();
	confirmationSubscription = new Subject<Confirmation>();
	stopppedElectionsSubscription = new Subject<StoppedElection>();

	socket: WebSocketSubject<any>;

	constructor(private http: HttpClient) {
	}

	async subscribe(): Promise<Subscriptions> {
		this.socket = webSocket<any>(this.wsUrl);
		this.socket.pipe(
			retryWhen(errors =>
				errors.pipe(tap(e =>
					console.error('WS Error', e),
					delay(5000),
				))
			)
		);

		this.socket.asObservable().subscribe(res => {
			switch (res.topic) {
				case 'vote':
					this.voteSubscription.next(res);
					break;
				case 'confirmation':
					this.confirmationSubscription.next(res);
					break;
				case 'stopped_election':
					this.stopppedElectionsSubscription.next(res);
					break;
				default:
					break;
			}
		});

		this.socket.next({
			'action': 'subscribe',
			'topic': 'vote',
			'options': {
				'representatives': this.principals.map(p => p.account),
			},
		});
		this.socket.next({
			'action': 'subscribe',
			'topic': 'confirmation',
			'options': {
				'confirmation_type': 'active',
				'include_election_info': 'false',
				'include_block': 'false',
			},
		});
		this.socket.next({
			'action': 'subscribe',
			'topic': 'stopped_election',
		});

		return {
			votes: this.voteSubscription,
			confirmations: this.confirmationSubscription,
			stoppedElections: this.stopppedElectionsSubscription,
		};
	}

	checkAndReconnectSocket() {
		if (this.socket && this.socket.closed) {
			this.subscribe();
		}
	}

	async updatePrincipalsAndQuorum() {
		try {
			this.principals = await this.http.get<Principal[]>('https://mynano.ninja/api/accounts/principals').toPromise();
			this.principals.forEach(p => this.principalWeights.set(p.account, new BigNumber(p.votingweight).shiftedBy(-30).toNumber()));

			const quorumResponse = await this.http.post<ConfirmationQuorumResponse>(this.rpcUrl, {
				'action': 'confirmation_quorum'
			}).toPromise();

			this.quorumPercent = Number(quorumResponse.online_weight_quorum_percent);
			this.onlineStake = new BigNumber(tools.convert(quorumResponse.online_stake_total, 'RAW', 'NANO')).toNumber();
		} catch (e) {
			console.error('Error updaging principals and quorum', e);
		}
	}

}

export interface Subscriptions {
	votes: Subject<Vote>;
	confirmations: Subject<Confirmation>;
	stoppedElections: Subject<StoppedElection>;
}

export interface Principal {
	account: string;
	alias: string;
	delegators: number;
	uptime: number;
	votelatency: number;
	votingweight: number;
	cemented: string;
}

export interface Vote extends ResponseBase {
	message: VoteMessage;
}

export interface VoteMessage {
	account: string;
	signature: string;
	sequence: string;
	blocks: string[];
	type: string;
}

export interface Confirmation extends ResponseBase {
	message: ConfirmationMessage;
}

export interface ConfirmationMessage {
	account: string;
	amount: string;
	hash: string;
	confirmation_type: string;
}

export interface StoppedElection extends ResponseBase {
	message: StoppedElectionHash;
}

export interface StoppedElectionHash {
	hash: string;
}

export interface ResponseBase {
	topic: string;
	time: string;
}

export interface ConfirmationQuorumResponse {
	quorum_delta: string;
	online_weight_quorum_percent: string;
	online_weight_minimum: string;
	online_stake_total: string;
	peers_stake_total: string;
	trended_stake_total: string;
}
