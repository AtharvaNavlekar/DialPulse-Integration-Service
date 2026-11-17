import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearchTerms, rankSearchResults } from './search-utils.ts';

test('matches and ranks global search results with prefix priority', () => {
  assert.equal(matchesSearchTerms('loan', 'Synthetic Loan Enquiry'), true);
  assert.equal(matchesSearchTerms('unknown', 'Synthetic Loan Enquiry'), false);

  const ranked = rankSearchResults('loan', [
    {
      id: '2',
      entityType: 'form',
      title: 'Business Enquiry Loan',
      subtitle: 'Form',
      routePath: '/forms/2/builder',
    },
    {
      id: '1',
      entityType: 'form',
      title: 'Loan Intake Form',
      subtitle: 'Form',
      routePath: '/forms/1/builder',
    },
  ]);

  assert.equal(ranked[0]?.id, '1');
});
