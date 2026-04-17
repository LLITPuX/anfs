import { FalkorDB, Graph } from 'falkordb';
let vscode: any;
try {
    vscode = require('vscode');
} catch (e) {
    // CLI mode
}

export class FalkorDBManager {
    private db: FalkorDB | null = null;
    private statusBarItem: any;

    constructor(statusBarItem?: any) {
        this.statusBarItem = statusBarItem || null as any;
        this.updateStatus('🔴 Disconnected');
    }

    public async connect(): Promise<void> {
        this.updateStatus('⏳ Syncing');

        try {
            this.db = await FalkorDB.connect({
                url: 'redis://127.0.0.1:6379',
                socket: {
                    reconnectStrategy: (retries: number) => {
                        return Math.min(retries * 1000, 5000);
                    }
                } as any
            });

            this.updateStatus('🟢 Connected');
            if (this.statusBarItem) {
                vscode.window.showInformationMessage('ANFS: Connected to FalkorDB');
            } else {
                console.log('ANFS: Connected to FalkorDB');
            }

            const redisClient = await this.db.connection;

            redisClient.on('error', (err: any) => {
                this.updateStatus('🔴 Disconnected');
            });

            redisClient.on('end', () => {
                this.updateStatus('🔴 Disconnected');
            });

            redisClient.on('reconnecting', () => {
                this.updateStatus('⏳ Syncing');
            });

            redisClient.on('ready', () => {
                this.updateStatus('🟢 Connected');
            });

        } catch (err: any) {
            this.updateStatus('🔴 Disconnected');
            console.error('Failed to connect to FalkorDB', err);
            if (this.statusBarItem) {
                vscode.window.showErrorMessage(`ANFS: Initial Connection Failed: ${err.message}`);
            }
        }
    }

    public getGraph(graphName: string): Graph | null {
        if (!this.db) return null;
        const graph = this.db.selectGraph(graphName);
        return graph;
    }

    public async ensureIndices(graph: Graph): Promise<void> {
        const labels = ['Commit', 'File', 'CodeBlock', 'Folder', 'Repository', 'Diff'];
        for (const label of labels) {
            try {
                await graph.query(`CREATE INDEX FOR (n:${label}) ON (n.valid_at)`);
                await graph.query(`CREATE INDEX FOR (n:${label}) ON (n.transaction_at)`);
            } catch (e) {
                // Index might already exist
            }
        }
    }

    public dispose() {
        if (this.db) {
            this.db.close();
        }
    }

    private updateStatus(text: string) {
        if (this.statusBarItem) {
            this.statusBarItem.text = `ANFS: ${text}`;
            this.statusBarItem.show();
        } else {
            console.log(`ANFS Status: ${text}`);
        }
    }
}

