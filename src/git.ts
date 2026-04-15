import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

export async function checkAndInitRepo(workspacePath: string): Promise<boolean> {
    const gitPath = path.join(workspacePath, '.git');
    if (!fs.existsSync(gitPath)) {
        try {
            await execAsync('git init', { cwd: workspacePath });
            await execAsync('git add .', { cwd: workspacePath });
            await execAsync('git commit -m "chore: initial commit by ANFS"', { cwd: workspacePath });
            return true; // Newly initialized
        } catch (error) {
            console.error('Failed to init git repository', error);
            return false;
        }
    }
    return false; // Already initialized
}

export async function getTrackedFiles(workspacePath: string): Promise<string[]> {
    try {
        const { stdout } = await execAsync('git ls-files', { cwd: workspacePath });
        return stdout.trim().split('\n').filter(f => f.length > 0);
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
        // Safe delimiter approach to avoid JSON injection/breaking
        const formatStr = '%H|~|%an|~|%at|~|%s';
        const { stdout } = await execAsync(`git log -n ${limit} --format="${formatStr}"`, { cwd: workspacePath });
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
        const { stdout } = await execAsync(`git show --numstat --format="" ${commitHash}`, { cwd: workspacePath });
        const lines = stdout.trim().split('\n').filter(line => line.length > 0);
        const result: GitDiffFile[] = [];
        for (const line of lines) {
            const parts = line.split('\t');
            if (parts.length === 3) {
                const addedStr = parts[0].trim();
                const deletedStr = parts[1].trim();
                const file = parts[2].trim();
                result.push({
                    file,
                    additions: addedStr === '-' ? 0 : parseInt(addedStr, 10),
                    deletions: deletedStr === '-' ? 0 : parseInt(deletedStr, 10)
                });
            }
        }
        return result;
    } catch {
        return [];
    }
}
