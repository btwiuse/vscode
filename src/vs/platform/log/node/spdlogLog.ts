/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AbstractMessageLogger, ILogger, LogLevel } from '../common/log.js';

interface ILog {
	level: LogLevel;
	message: string;
}

function log(level: LogLevel, message: string): void {
	switch (level) {
		case LogLevel.Trace: console.trace(message); break;
		case LogLevel.Debug: console.debug(message); break;
		case LogLevel.Info: console.info(message); break;
		case LogLevel.Warning: console.warn(message); break;
		case LogLevel.Error: console.error(message); break;
		case LogLevel.Off: /* do nothing */ break;
		default: throw new Error(`Invalid log level ${level}`);
	}
}

function setLogLevel(level: LogLevel): void {
	// No-op for console.log based implementation
}

export class SpdLogLogger extends AbstractMessageLogger implements ILogger {

	private buffer: ILog[] = [];

	constructor(
		name: string,
		filepath: string,
		rotating: boolean,
		donotUseFormatters: boolean,
		level: LogLevel,
	) {
		super();
		this.setLevel(level);
		this._register(this.onDidChangeLogLevel(level => {
			setLogLevel(level);
		}));
	}

	protected log(level: LogLevel, message: string): void {
		if (this.getLevel() <= level) {
			log(level, message);
		} else {
			this.buffer.push({ level, message });
		}
	}

	override flush(): void {
		for (const { level, message } of this.buffer) {
			log(level, message);
		}
		this.buffer = [];
	}

	override dispose(): void {
		this.flush();
		super.dispose();
	}
}
