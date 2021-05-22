import BigNumber from 'bignumber.js'
import { tools } from 'nanocurrency-web';
import { Observable } from 'rxjs';
import { webSocket } from 'rxjs/webSocket';

import { HttpClient } from '@angular/common/http';
import { Injectable } from "@angular/core";

@Injectable()
export class NanoWebsocketService {

	wsUrl = 'wss://nanows.numsu.dev';
	rpcUrl = 'https://nanoproxy.numsu.dev/proxy';

	principals: Principal[] = [];
	principalWeights = new Map<string, number>();
	quorumDelta: number;

	constructor(private http: HttpClient) {
	}

	async subscribeToVotes(): Promise<Observable<Vote>> {
		if (this.principals.length === 0) {
			this.principals = await this.http.get<Principal[]>('https://mynano.ninja/api/accounts/principals').toPromise();
			this.principals.forEach(p => this.principalWeights.set(p.account, new BigNumber(p.votingweight).shiftedBy(-30).toNumber()));

			const quorumResponse = await this.http.post<ConfirmationQuorumResponse>(this.rpcUrl, {
				'action': 'confirmation_quorum'
			}).toPromise();

			this.quorumDelta = new BigNumber(tools.convert(quorumResponse.quorum_delta, 'RAW', 'NANO')).toNumber();
		}

		const socket = webSocket<Vote>(this.wsUrl);
		socket.next({
			'action': 'subscribe',
			'topic': 'vote',
			'options': {
				'representatives': this.principals.map(p => p.account),
			},
		} as any);
		return socket.asObservable();
	}

	async subscribeToConfirmations(): Promise<Observable<Confirmation>> {
		const socket = webSocket<Confirmation>(this.wsUrl);
		socket.next({
			'action': 'subscribe',
			'topic': 'confirmation',
			'options': {
				'confirmation_type': 'active',
				'include_election_info': 'false',
				'include_block': 'false',
			},
		} as any);
		return socket.asObservable();
	}

	async subscribeToStoppedElections(): Promise<Observable<StoppedElection>> {
		const socket = webSocket<StoppedElection>(this.wsUrl);
		socket.next({
			'action': 'subscribe',
			'topic': 'stopped_election',
		} as any);
		return socket.asObservable();
	}

}

export interface Principal {
	account: string;
	alias: string;
	delegators: number;
	uptime: number;
	votelatency: number;
	votingweight: number;
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

export interface ConfirmationElectionInfo {
	duration: string;
	time: string;
	tally: string;
	request_count: string;
	blocks: string;
	voters: string;
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