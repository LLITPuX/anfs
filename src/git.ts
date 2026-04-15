import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

/**
 * Executes a git command and returns the raw Buffer.
 */
async function gitExecRaw(args: string, cwd: string): Promise<Buffer> {
    const { stdout } = await execAsync(`git -c core.quotepath=false ${args}`, { cwd, encoding: 'buffer' });
    return stdout as unknown as Buffer;
}

/**
 * Executes a git command and returns the decoded UTF-8 string.
 */
async function gitExec(args: string, cwd: string): Promise<string> {
    const buffer = await gitExecRaw(args, cwd);
    return buffer.toString('utf8');
}

export async function checkAndInitRepo(workspacePath: string): Promise<boolean> {
    const gitPath = path.join(workspacePath, '.git');
    if (!fs.existsSync(gitPath)) {
        try {
            await gitExec('init', workspacePath);
            await gitExec('add .', workspacePath);
            await gitExec('commit -m "chore: initial commit by ANFS"', workspacePath);
            return true;
        } catch (error) {
            console.error('Failed to init git repository', error);
            return false;
        }
    }
    return false;
}

export async function getTrackedFiles(workspacePath: string): Promise<string[]> {
    try {
        const buffer = await gitExecRaw('ls-files -z', workspacePath);
        // Split by null byte on buffer level or string level (null byte is 0x00)
        return buffer.toString('utf8').split('\0').filter(f => f.length > 0);
    } catch {
        return [];
    }
}

export interface GitCommit {
    hash: string;
    author: string;
    timestamp: number;
    message: string;
}

export async function getGitLog(workspacePath: string, limit: number = 100): Promise<GitCommit[]> {
    try {
        const formatStr = '%H|~|%an|~|%at|~|%s';
        const stdout = await gitExec(`log -n ${limit} --format="${formatStr}"`, workspacePath);
        const lines = stdout.trim().split('\n').filter(line => line.length > 0);
        return lines.map(line => {
            const parts = line.split('|~|');
            if (parts.length >= 4) {
                return {
                    hash: parts[0],
                    author: parts[1],
                    timestamp: parseInt(parts[2], 10),
                    message: parts.slice(3).join('|~|')
                };
            }
            return null;
        }).filter(c => c !== null) as GitCommit[];
    } catch {
        return [];
    }
}

export interface GitDiffFile {
    file: string;
    additions: number;
    deletions: number;
}

export async function getGitDiff(workspacePath: string, commitHash: string): Promise<GitDiffFile[]> {
    try {
        const buffer = await gitExecRaw(`show --numstat -z --format=format: ${commitHash}`, workspacePath);
        const parts = buffer.toString('utf8').split('\0').filter(p => p.length > 0);
        const result: GitDiffFile[] = [];

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part.includes('\t')) {
                const subParts = part.split('\t');
                if (subParts.length >= 3) {
                    const added = parseInt(subParts[0], 10) || 0;
                    const deleted = parseInt(subParts[1], 10) || 0;
                    const filePath = subParts[2];

                    if (filePath.length > 0) {
                        result.push({ file: filePath, additions: added, deletions: deleted });
                    } else {
                        // Rename
                        const oldPath = parts[++i];
                        const newPath = parts[++i];
                        if (newPath) {
                            result.push({ file: newPath, additions: added, deletions: deleted });
                        }
                    }
                }
            }
        }
        return result;
    } catch (error) {
        console.error('getGitDiff error:', error);
        return [];
    }
}
