import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspacePath, parseWorkspaceRoute } from './routes.ts';

test('parses and serializes top-level, nested, cost center, and integrations console routes accurately', () => {
  assert.deepEqual(parseWorkspaceRoute('/'), {
    section: 'overview',
    formId: null,
    formTab: 'list',
    automationId: null,
    automationTab: 'workflows',
    costTab: 'overview',
    settingsTab: 'organization',
    integrationsTab: 'overview',
  });

  assert.deepEqual(parseWorkspaceRoute('/forms/14/analytics'), {
    section: 'forms-studio',
    formId: 14,
    formTab: 'analytics',
    automationId: null,
    automationTab: 'workflows',
    costTab: 'overview',
    settingsTab: 'organization',
    integrationsTab: 'overview',
  });

  assert.deepEqual(parseWorkspaceRoute('/automations/templates'), {
    section: 'workflow-automation',
    formId: null,
    formTab: 'list',
    automationId: null,
    automationTab: 'templates',
    costTab: 'overview',
    settingsTab: 'organization',
    integrationsTab: 'overview',
  });

  assert.deepEqual(parseWorkspaceRoute('/automations/9'), {
    section: 'workflow-automation',
    formId: null,
    formTab: 'list',
    automationId: 9,
    automationTab: 'editor',
    costTab: 'overview',
    settingsTab: 'organization',
    integrationsTab: 'overview',
  });

  assert.deepEqual(parseWorkspaceRoute('/costs/records'), {
    section: 'cost-control-center',
    formId: null,
    formTab: 'list',
    automationId: null,
    automationTab: 'workflows',
    costTab: 'records',
    settingsTab: 'organization',
    integrationsTab: 'overview',
  });

  assert.deepEqual(parseWorkspaceRoute('/settings/integrations'), {
    section: 'settings',
    formId: null,
    formTab: 'list',
    automationId: null,
    automationTab: 'workflows',
    costTab: 'overview',
    settingsTab: 'integrations',
    integrationsTab: 'overview',
  });

  assert.deepEqual(parseWorkspaceRoute('/settings/integrations/dlq'), {
    section: 'settings',
    formId: null,
    formTab: 'list',
    automationId: null,
    automationTab: 'workflows',
    costTab: 'overview',
    settingsTab: 'integrations',
    integrationsTab: 'dlq',
  });

  assert.deepEqual(parseWorkspaceRoute('/settings/integrations/unknown-tab'), {
    section: 'settings',
    formId: null,
    formTab: 'list',
    automationId: null,
    automationTab: 'workflows',
    costTab: 'overview',
    settingsTab: 'integrations',
    integrationsTab: 'overview',
  });

  assert.equal(
    buildWorkspacePath('forms-studio', { formId: 14, formTab: 'submissions' }),
    '/forms/14/submissions'
  );
  assert.equal(
    buildWorkspacePath('workflow-automation', { automationTab: 'executions' }),
    '/automations/executions'
  );
  assert.equal(buildWorkspacePath('cost-control-center'), '/costs');
  assert.equal(
    buildWorkspacePath('cost-control-center', { costTab: 'budgets' }),
    '/costs/budgets'
  );
  assert.equal(
    buildWorkspacePath('settings', { settingsTab: 'integrations' }),
    '/settings/integrations'
  );
  assert.equal(
    buildWorkspacePath('settings', {
      settingsTab: 'integrations',
      integrationsTab: 'webhooks',
    }),
    '/settings/integrations/webhooks'
  );
  assert.equal(buildWorkspacePath('notifications'), '/notifications');
  assert.equal(buildWorkspacePath('profile'), '/profile');
  assert.equal(buildWorkspacePath('preferences'), '/preferences');
});
