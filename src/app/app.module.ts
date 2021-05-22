import { QRCodeModule } from 'angularx-qrcode';

import { HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { NanoWebsocketService } from './ws.service';

@NgModule({
	declarations: [
		AppComponent,
	],
	imports: [
		BrowserModule,
		AppRoutingModule,
		HttpClientModule,
		QRCodeModule,
	],
	providers: [
		NanoWebsocketService,
	],
	bootstrap: [AppComponent],
})
export class AppModule { }
