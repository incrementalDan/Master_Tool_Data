import { describe, it, expect } from 'vitest';
import { jobKey, findJob, jobById, newJob, jobLabel, collectToolJobs } from './jobs.js';

const file = {
  version: 1,
  jobs: [
    { id: 'j1', program_number: 'O1042', part_number: 'PN-4417-A' },
    { id: 'j2', program_number: 'O2210', part_number: 'PN-3308' },
  ],
};

describe('jobs helpers', () => {
  it('jobKey normalizes case and whitespace', () => {
    expect(jobKey(' O1042 ', 'pn-4417-a')).toBe(jobKey('o1042', ' PN-4417-A'));
    expect(jobKey('O1042', 'A')).not.toBe(jobKey('O1042', 'B'));
  });

  it('findJob matches the pair case-insensitively (dedupe seam)', () => {
    expect(findJob(file, 'o1042 ', ' pn-4417-a')?.id).toBe('j1');
    expect(findJob(file, 'O1042', 'PN-9999')).toBeNull();
    expect(findJob({ jobs: [] }, 'O1', 'P1')).toBeNull();
  });

  it('jobById / jobLabel', () => {
    expect(jobById(file, 'j2')?.program_number).toBe('O2210');
    expect(jobById(file, 'nope')).toBeNull();
    expect(jobLabel(file.jobs[0])).toBe('O1042 · PN-4417-A');
    expect(jobLabel({ program_number: 'O5', part_number: '' })).toBe('O5');
    expect(jobLabel(null)).toBe('');
  });

  it('newJob trims inputs and mints a uuid', () => {
    const j = newJob(' O77 ', ' P88 ', 'me');
    expect(j.program_number).toBe('O77');
    expect(j.part_number).toBe('P88');
    expect(j.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(j.created_by).toBe('me');
  });

  it('collectToolJobs dedupes across tool + preset links and skips dangling ids', () => {
    const tool = {
      job_ids: ['j1', 'gone'],
      presets: [
        { name: 'AL Rough', job_ids: ['j1', 'j2'] },
        { name: 'AL Finish', job_ids: ['j2'] },
      ],
    };
    const rows = collectToolJobs(tool, file);
    expect(rows).toHaveLength(2);   // j1 + j2; 'gone' skipped
    const j1 = rows.find(r => r.job.id === 'j1');
    const j2 = rows.find(r => r.job.id === 'j2');
    expect(j1.presetNames).toEqual(['AL Rough']);            // also tool-level, listed once
    expect(j2.presetNames).toEqual(['AL Rough', 'AL Finish']);
  });
});
