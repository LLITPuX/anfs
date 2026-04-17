import { FalkorDBManager } from './falkordb';
import { performSync } from './sync';
import { ASTParser } from './ast';
import * as path from 'path';

async function main() {
    const workspacePath = 'c:/grynya_workspace'; // Hardcoded for this environment
    const falkorDBManager = new FalkorDBManager();
    const astParser = new ASTParser();
    
    // AST Parser typically needs extensionPath for WASM, 
    // but we'll try to use the local projects/anfs path
    const extensionPath = path.resolve(__dirname, '..');
    astParser.init(extensionPath);

    console.log('ANFS CLI: Initializing autonomous sync...');
    
    try {
        await falkorDBManager.connect();
        await performSync(falkorDBManager, workspacePath, astParser);
        process.exit(0);
    } catch (error) {
        console.error('ANFS CLI Fatal Error:', error);
        process.exit(1);
    }
}

main();
