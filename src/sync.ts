import * as vscode from 'vscode';
import * as path from 'path';
import { posix as posixPath } from 'path';
import { FalkorDBManager } from './falkordb';
import { checkAndInitRepo, getTrackedFiles, getGitLog, getGitDiff, getGitDiffHunks, isIgnored } from './git';
import * as fs from 'fs';
import { ASTParser } from './ast';
import { Graph } from 'falkordb';

export async function performSync(falkorDBManager: FalkorDBManager, workspacePath: string, astParser: ASTParser) {
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

        const normalizedRepoPath = normalizeToPosix(workspacePath);

        // 2. Create/Merge Repository Node
        await graph.query(`
            MERGE (r:Repository {path: $path})
            SET r.name = $name, 
                r.transaction_at = timestamp(),
                r.valid_at = timestamp()
        `, { params: { path: normalizedRepoPath, name: repoName } });

        await falkorDBManager.ensureIndices(graph);

        // 3. Sync Files & Folders
        const files = await getTrackedFiles(workspacePath);
        for (const file of files) {
            const relPath = normalizeToPosix(file);
            await ensureFolderHierarchy(graph, workspacePath, relPath);

            const fullPath = path.isAbsolute(file) ? file : path.join(workspacePath, file);
            const content = getFileContent(fullPath);
            await syncAST(graph, relPath, content, astParser);
        }

        // 4. Sync Commits and Diffs
        const commits = await getGitLog(workspacePath); // Full history
        for (const commit of commits) {
            await graph.query(`
                MATCH (r:Repository {path: $repoPath})
                MERGE (c:Commit {hash: $hash})
                SET c.author = $author, c.timestamp = $timestamp, c.message = $message,
                    c.valid_at = $timestamp,
                    c.transaction_at = timestamp()
                MERGE (r)-[:HAS_COMMIT]->(c)
            `, { params: { repoPath: normalizeToPosix(workspacePath), ...commit } });

            const hunks = await getGitDiffHunks(workspacePath, commit.hash);
            for (const hunk of hunks) {
                const relHunkPath = normalizeToPosix(hunk.file);
                await graph.query(`
                    MATCH (c:Commit {hash: $hash})
                    MERGE (f:File {path: $filePath})
                    MERGE (diff:Diff {commit_hash: $hash, path: $filePath, hunk: $hunkHeader})
                    SET diff.old_start = $oldStart, diff.old_lines = $oldLines,
                        diff.new_start = $newStart, diff.new_lines = $newLines,
                        diff.valid_at = $commit_timestamp,
                        diff.transaction_at = timestamp()
                    MERGE (c)-[:CONTAINS]->(diff)
                    MERGE (diff)-[:ON_FILE]->(f)
                    
                    WITH diff, f
                    MATCH (f)-[:CONTAINS_BLOCK]->(b:CodeBlock)
                    WHERE b.start_line <= ($newStart + $newLines - 1) AND b.end_line >= $newStart
                    MERGE (diff)-[:AFFECTS]->(b)
                `, {
                    params: {
                        hash: commit.hash,
                        commit_timestamp: commit.timestamp,
                        filePath: relHunkPath,
                        hunkHeader: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
                        oldStart: hunk.oldStart,
                        oldLines: hunk.oldLines,
                        newStart: hunk.newStart,
                        newLines: hunk.newLines
                    }
                });
            }
        }

        vscode.window.showInformationMessage(`ANFS: Sync complete for ${repoName}! Graph populated with ${commits.length} commits.`);

    } catch (error: any) {
        console.error('ANFS Sync Error:', error);
        vscode.window.showErrorMessage(`ANFS Sync Error: ${error.message}`);
    }
}

const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.bin', '.iso']);

function getFileContent(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
        return ''; // Don't store content for known binary types
    }

    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.error(`Error reading file ${filePath}:`, err);
        return '';
    }
}

export async function syncFileChange(falkorDBManager: FalkorDBManager, workspacePath: string, filePath: string, astParser: ASTParser) {
    if (await isIgnored(workspacePath, filePath)) return;

    const graphName = `${path.basename(workspacePath)}_code`;
    const graph = falkorDBManager.getGraph(graphName);
    if (!graph) return;

    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspacePath, filePath);
    const relPath = normalizeToPosix(path.isAbsolute(filePath) ? path.relative(workspacePath, filePath) : filePath);
    const content = getFileContent(fullPath);
    const contentHash = Buffer.from(content).toString('base64').slice(0, 16); // Simple hash for now

    await ensureFolderHierarchy(graph, workspacePath, relPath);
    await syncAST(graph, relPath, content, astParser);
}

export async function syncFileCreate(falkorDBManager: FalkorDBManager, workspacePath: string, filePaths: string[], astParser: ASTParser) {
    const graphName = `${path.basename(workspacePath)}_code`;
    const graph = falkorDBManager.getGraph(graphName);
    if (!graph) return;

    for (const filePath of filePaths) {
        if (await isIgnored(workspacePath, filePath)) continue;

        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspacePath, filePath);
        const relPath = normalizeToPosix(path.isAbsolute(filePath) ? path.relative(workspacePath, filePath) : filePath);
        const content = getFileContent(fullPath);

        await ensureFolderHierarchy(graph, workspacePath, relPath);
        await syncAST(graph, relPath, content, astParser);
    }
}

export async function syncFileRename(falkorDBManager: FalkorDBManager, workspacePath: string, oldPath: string, newPath: string) {
    const graphName = `${path.basename(workspacePath)}_code`;
    const graph = falkorDBManager.getGraph(graphName);
    if (!graph) return;

    const oldRelPath = normalizeToPosix(path.isAbsolute(oldPath) ? path.relative(workspacePath, oldPath) : oldPath);
    const newRelPath = normalizeToPosix(path.isAbsolute(newPath) ? path.relative(workspacePath, newPath) : newPath);

    // We use a query that updates the path of the existing File node
    await graph.query(`
        MATCH (f:File {path: $oldPath})
        SET f.path = $newPath, 
            f.valid_at = timestamp(),
            f.transaction_at = timestamp()
    `, { params: { oldPath: oldRelPath, newPath: newRelPath } });
}

export async function syncFileDelete(falkorDBManager: FalkorDBManager, workspacePath: string, filePaths: string[]) {
    const graphName = `${path.basename(workspacePath)}_code`;
    const graph = falkorDBManager.getGraph(graphName);
    if (!graph) return;

    for (const filePath of filePaths) {
        const relPath = normalizeToPosix(path.isAbsolute(filePath) ? path.relative(workspacePath, filePath) : filePath);
        await graph.query(`
            MATCH (f:File {path: $path})
            SET f.expired_at = timestamp(), f.transaction_at = timestamp()
            WITH f
            MATCH (f)-[:CONTAINS_BLOCK]->(b)
            SET b.expired_at = timestamp(), b.transaction_at = timestamp()
        `, { params: { path: relPath } });
    }
}

async function syncAST(graph: Graph, relPath: string, content: string, astParser: ASTParser) {
    const language = path.extname(relPath).slice(1) || 'unknown';
    const blocks = astParser.extractBlocks(content, language);

    // 1. Mark existing blocks as expired
    await graph.query(`
        MATCH (f:File {path: $path})-[:CONTAINS_BLOCK]->(b)
        SET b.expired_at = timestamp(), b.transaction_at = timestamp()
    `, { params: { path: relPath } });

    // 2. Merge new blocks
    if (blocks.length > 0) {
        await graph.query(`
            MATCH (f:File {path: $path})
            UNWIND $blocks AS b
            MERGE (block:CodeBlock {path: f.path, name: b.name, type: b.type, start_line: b.start_line})
            SET block.code_body = b.code_body, 
                block.end_line = b.end_line, 
                block.valid_at = timestamp(),
                block.transaction_at = timestamp()
            REMOVE block.expired_at
            MERGE (f)-[:CONTAINS_BLOCK]->(block)
        `, { params: { path: relPath, blocks: blocks.map(b => ({ ...b })) } });
    }
}

function normalizeToPosix(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
}

async function ensureFolderHierarchy(graph: Graph, workspacePath: string, relPath: string) {
    const segments = relPath.split(/[\\\/]/);
    const fileName = segments.pop()!;
    let currentParentType = 'Repository';
    let currentParentPath = normalizeToPosix(workspacePath);
    let accumulatedPath = '';

    for (const segment of segments) {
        const nextPath = accumulatedPath ? posixPath.join(accumulatedPath, segment) : segment;
        
        await graph.query(`
            MATCH (p:${currentParentType} {path: $parentPath})
            MERGE (f:Folder {path: $path})
            ON CREATE SET f.name = $name, 
                          f.valid_at = timestamp(), 
                          f.transaction_at = timestamp()
            MERGE (p)-[:CONTAINS]->(f)
        `, { params: { parentPath: currentParentPath, path: nextPath, name: segment } });

        currentParentType = 'Folder';
        currentParentPath = nextPath;
        accumulatedPath = nextPath;
    }

    // Finally connect the file
    await graph.query(`
        MATCH (p:${currentParentType} {path: $parentPath})
        MERGE (f:File {path: $path})
        ON CREATE SET f.name = $name, 
                      f.language = $language, 
                      f.valid_at = timestamp(), 
                      f.transaction_at = timestamp()
        SET f.timestamp = timestamp()
        MERGE (p)-[:CONTAINS]->(f)
    `, { params: { 
        parentPath: currentParentPath, 
        path: normalizeToPosix(relPath), 
        name: fileName,
        language: path.extname(relPath).slice(1) || 'unknown'
    } });
}
