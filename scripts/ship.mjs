#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

function runGitCapture(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

function runGit(args) {
  const result = spawnSync('git', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function getCurrentBranch() {
  const branchResult = runGitCapture(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branchResult.status !== 0) {
    throw new Error('Unable to determine current Git branch.');
  }

  const branch = branchResult.stdout.trim();
  if (!branch || branch === 'HEAD') {
    throw new Error('Detached HEAD detected. Switch to a branch before running ship.');
  }

  return branch;
}

function isInsideGitRepository() {
  const result = runGitCapture(['rev-parse', '--is-inside-work-tree']);
  return result.status === 0 && result.stdout.trim() === 'true';
}

function hasStagedChanges() {
  const result = runGitCapture(['diff', '--cached', '--quiet']);
  return result.status === 1;
}

function hasUpstreamBranch() {
  const result = runGitCapture(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  return result.status === 0;
}

async function getCommitMessage() {
  const messageFromArgs = process.argv.slice(2).join(' ').trim();
  if (messageFromArgs) {
    return messageFromArgs;
  }

  const rl = createInterface({ input, output });
  const message = (await rl.question('Commit message: ')).trim();
  rl.close();

  return message;
}

async function main() {
  if (!isInsideGitRepository()) {
    console.error('Not inside a Git repository.');
    process.exit(1);
  }

  const commitMessage = await getCommitMessage();
  if (!commitMessage) {
    console.error('Commit message is required.');
    process.exit(1);
  }

  const branch = getCurrentBranch();

  console.log('Staging changes...');
  runGit(['add', '-A']);

  if (!hasStagedChanges()) {
    console.log('No changes to commit.');
    process.exit(0);
  }

  console.log('Creating commit...');
  runGit(['commit', '-m', commitMessage]);

  if (hasUpstreamBranch()) {
    console.log('Pushing to remote...');
    runGit(['push']);
  } else {
    console.log(`No upstream found. Pushing with upstream to origin/${branch}...`);
    runGit(['push', '-u', 'origin', branch]);
  }

  console.log('Done.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
