import { ICommonRequestArgs } from 'vscode-chrome-debug-core';
import { ChildProcess } from 'child_process';
import * as fs from 'fs'
import * as path from 'path'
import {Services} from '../services/debugAdapterServices'
import {DebugResult} from '../project/project';
import {LoggerHandler, Handlers, Tags} from '../common/logger';
import {EventEmitter} from 'events';
import * as utils from '../common/utilities';
import {IosProject} from '../project/iosProject';
import {AndroidProject} from '../project/androidProject';

export class NativeScriptDebugLauncher extends EventEmitter {
    public static TNS_PROCESS_CRASHED_EVENT = "tns_crash";
    public static TNS_PROCESS_LOG = "tns_log";

    private _tnsProcess: ChildProcess;

    public async processRequest(args: any) : Promise<any> {
        args = this.translateArgs(args);
        Services.appRoot = args.appRoot;
        Services.extensionClient().cleanBeforeDebug();
        const settings = await Services.extensionClient().getInitSettings();

        Services.cliPath = settings.tnsPath || Services.cliPath;

        const project = args.platform == "ios" ?
            new IosProject(args.appRoot, Services.cli()) :
            new AndroidProject(args.appRoot, Services.cli());

        Services.extensionClient().analyticsLaunchDebugger({ request: args.request, platform: args.platform });

        // Run CLI Command
        this.log(`[NSDebugAdapter] Using tns CLI v${project.cli.version.version} on path '${project.cli.path}'\n`);
        this.log('[NSDebugAdapter] Running tns command...\n');
        let cliCommand: DebugResult;

        if (args.request === "launch") {
            let tnsArgs = args.tnsArgs;

            // For iOS the TeamID is required if there's more than one.
            // Therefore if not set, show selection to the user.
            if(args.platform && args.platform.toLowerCase() === 'ios') {
                let teamId = this.getTeamId(path.join(Services.appRoot, 'app'), tnsArgs);
                if(!teamId) {
                    let selectedTeam = (await Services.extensionClient().selectTeam());
                    if(selectedTeam) {
                        // add the selected by the user Team Id
                        tnsArgs = (tnsArgs || []).concat(['--teamId', selectedTeam.id]);
                        this.log(`[NSDebugAdapter] Using iOS Team ID '${selectedTeam.id}', you can change this in the workspace settings.\n`);
                    }
                }
            }

            cliCommand = project.debug({ stopOnEntry: args.stopOnEntry, watch: args.watch }, tnsArgs);
        }
        else if (args.request === "attach") {
            cliCommand = project.attach(args.tnsArgs);
        }

        if (cliCommand.tnsProcess) {
            this._tnsProcess = cliCommand.tnsProcess;
            cliCommand.tnsProcess.stdout.on('data', data => { this.log(data.toString()); });
            cliCommand.tnsProcess.stderr.on('data', data => { this.log(data.toString()); });

            cliCommand.tnsProcess.on('close', (code, signal) => {
                this.log(`[NSDebugAdapter] The tns command finished its execution with code ${code}.\n`);

                // Sometimes we execute "tns debug android --start" and the process finishes
                // which is totally fine. If there's an error we need to Terminate the session.
                if(code !== 0) {
                    this.emit(NativeScriptDebugLauncher.TNS_PROCESS_CRASHED_EVENT, `The tns command finished its execution with code ${code}`) ;
                }
            });
        }

        this.log('[NSDebugAdapter] Watching the tns CLI output to receive a connection token\n');

        return new Promise<string | number> ((res, rej) => {
            cliCommand.tnsOutputEventEmitter.on('readyForConnection', (connectionToken: string | number) => {
                this.log(`[NSDebugAdapter] Ready to attach to application on ${connectionToken}\n`);
                args.port = connectionToken;

                res(args);
            });
        });
    }

    public disconnect(): void {
        if (this._tnsProcess) {
            utils.killProcess(this._tnsProcess);
            this._tnsProcess = null;
        }
    }

    private translateArgs(args): any {
        if(args.diagnosticLogging) {
            args.trace = args.diagnosticLogging;
        }

        if(args.appRoot) {
            args.webRoot = args.appRoot;
        }

        return args;
    }

    private log(text: string): void {
        this.emit(NativeScriptDebugLauncher.TNS_PROCESS_LOG, text);
    }

    private getTeamId(appRoot: string, tnsArgs?: string[]): string {
        // try to get the TeamId from the TnsArgs
        if(tnsArgs) {
            const teamIdArgIndex = tnsArgs.indexOf('--teamId');
            if(teamIdArgIndex > 0 && teamIdArgIndex + 1 < tnsArgs.length) {
                return tnsArgs[ teamIdArgIndex + 1 ];
            }
        }

        // try to get the TeamId from the buildxcconfig or teamid file
        const teamIdFromConfig = this.readTeamId(appRoot);
        if(teamIdFromConfig) {
            return teamIdFromConfig;
        }

        // we should get the Teams from the machine and ask the user if they are more than 1
        return null;
    }

    private readXCConfig(appRoot: string, flag: string): string {
		let xcconfigFile = path.join(appRoot, "App_Resources/iOS/build.xcconfig");
		if (fs.existsSync(xcconfigFile)) {
			let text = fs.readFileSync(xcconfigFile, { encoding: 'utf8'});
			let teamId: string;
			text.split(/\r?\n/).forEach((line) => {
				line = line.replace(/\/(\/)[^\n]*$/, "");
				if (line.indexOf(flag) >= 0) {
					teamId = line.split("=")[1].trim();
					if (teamId[teamId.length - 1] === ';') {
						teamId = teamId.slice(0, -1);
					}
				}
			});
			if (teamId) {
				return teamId;
			}
		}

		let fileName = path.join(appRoot, "teamid");
		if (fs.existsSync(fileName)) {
			return fs.readFileSync(fileName, { encoding: 'utf8' });
		}

		return null;
	}

	private readTeamId(appRoot): string {
		return this.readXCConfig(appRoot, "DEVELOPMENT_TEAM");
	}
}