import { ChromeDebugAdapter, IAttachRequestArgs, utils, ISetBreakpointsArgs, ISetBreakpointsResponseBody } from 'vscode-chrome-debug-core';

export class NativeScriptDebugAdapter extends ChromeDebugAdapter {
    public async attach(args: IAttachRequestArgs): Promise<void> {
        try {
            return super.attach(args);
        } catch (err) {
            if (err.format && err.format.indexOf('Cannot connect to runtime process') >= 0) {
                // hack -core error msg
                err.format = 'Ensure Node was launched with --inspect. ' + err.format;
            }

            throw err;
        }
    }

    public setBreakpoints(args: ISetBreakpointsArgs, requestSeq: number, ids?: number[]): Promise<ISetBreakpointsResponseBody> {
        if (args.source.path) {
            args.source.path = utils.fixDriveLetterAndSlashes(args.source.path);
        }

        return super.setBreakpoints(args, requestSeq, ids);
    }

}