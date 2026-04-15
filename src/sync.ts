import * as vscode from 'vscode';
import * as path from 'path';
import { FalkorDBManager } from './falkordb';
import { checkAndInitRepo, getTrackedFiles, getGitLog, getGitDiff } from './git';

export async function performSync(falkorDBManager: FalkorDBManager, workspacePath: string) {
    const repoName = path.basename(workspacePath);
    const graphName = `${repoName}_code`;

    const graph = falkorDBManager.getGraph(graphName);
    if (!graph) {
        console.warn(`ANFS: Could not get graph ${graphName}. FalkorDB may not be connected yet.`);
        return;
    }

    try {
        vscode.window.showInformationMessage(`ANFS: Starting git sync for ${repoName}...`);

        // 1. Init Repository if needed
        await checkAndInitRepo(workspacePath);

        // 2. Create/Merge Repository Node
        await graph.query(`
            MERGE (r:Repository {path: $path})
            SET r.name = $name, r.timestamp = timestamp()
        `, { params: { path: workspacePath, name: repoName } });

        // 3. Sync Files using UNWIND
        const files = await getTrackedFiles(workspacePath);
        if (files.length > 0) {
            const fileParams = files.map(f => ({
                path: f,
                language: path.extname(f).slice(1) || 'unknown'
            }));
            
            await graph.query(`
                MATCH (r:Repository {path: $repoPath})
                UNWIND $files AS f
                MERGE (file:File {path: f.path})
                SET file.language = f.language
                MERGE (r)-[:CONTAINS]->(file)
            `, { params: { repoPath: workspacePath, files: fileParams } });
        }

        // 4. Sync Commits and Diffs
        const commits = await getGitLog(workspacePath, 50); // Limit to 50 for initial speed
        for (const commit of commits) {
            // Merge Commit Node
            await graph.query(`
                MATCH (r:Repository {path: $repoPath})
                MERGE (c:Commit {hash: $hash})
                SET c.author = $author, c.message = $message, c.timestamp = $timestamp, c.valid_at = $timestamp
                MERGE (r)-[:CONTAINS]->(c)
            `, { params: { 
                repoPath: workspacePath,
                hash: commit.hash, 
                author: commit.author, 
                message: commit.message, 
                timestamp: commit.timestamp 
            }});

            // Process diffs
            const diffs = await getGitDiff(workspacePath, commit.hash);
            if (diffs.length > 0) {
                await graph.query(`
                    MATCH (c:Commit {hash: $hash})
                    UNWIND $diffs AS d
                    MERGE (file:File {path: d.file})
                    MERGE (diff:Diff {commit_hash: $hash, file_path: d.file})
                    SET diff.additions = d.additions, diff.deletions = d.deletions
                    MERGE (c)-[:HAS_DIFF]->(diff)
                    MERGE (diff)-[:DIFF_OF]->(file)
                    MERGE (file)-[:MODIFIED_BY]->(c)
                `, { params: { hash: commit.hash, diffs: diffs as any } });
            }
        }

        vscode.window.showInformationMessage(`ANFS: Sync complete for ${repoName}! Graph populated.`);

    } catch (error: any) {
        console.error('ANFS Sync Error:', error);
        vscode.window.showErrorMessage(`ANFS Sync Error: ${error.message}`);
    }
}
