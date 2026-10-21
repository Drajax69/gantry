import { describe, expect, it } from 'vitest';
import { normalizePull } from '../packages/server/src/discover/remote.js';

describe('PR review status', () => {
  it('does not mistake passing checks or merge readiness for approval', () => {
    expect(normalizePull({ mergeStateStatus: 'CLEAN' }).reviewStatus).toBe('waiting');
  });

  it('reports comments and requested changes', () => {
    expect(normalizePull({ latestReviews: [{ state: 'COMMENTED' }] }).reviewStatus).toBe('commented');
    expect(normalizePull({ reviewDecision: 'CHANGES_REQUESTED' }).reviewStatus).toBe('changes_requested');
    expect(normalizePull({ latestReviews: [{ state: 'APPROVED' }, { state: 'CHANGES_REQUESTED' }] }).reviewStatus).toBe('changes_requested');
  });

  it('uses the overall approval decision over non-blocking review comments', () => {
    expect(normalizePull({ reviewDecision: 'APPROVED', latestReviews: [{ state: 'COMMENTED' }] }).reviewStatus).toBe('approved');
  });

  it('recognizes approval without branch protection but respects required reviews', () => {
    expect(normalizePull({ latestReviews: [{ state: 'APPROVED' }] }).reviewStatus).toBe('approved');
    expect(normalizePull({ reviewDecision: 'REVIEW_REQUIRED', latestReviews: [{ state: 'APPROVED' }] }).reviewStatus).toBe('waiting');
    expect(normalizePull({ latestReviews: [{ state: 'DISMISSED' }] }).reviewStatus).toBe('waiting');
  });
});
