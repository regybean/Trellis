/**
 * `acme.infra`, which had no validator anywhere — so a typo was accepted and
 * produced a compose profile matching no service, and the symptom was a
 * container that never started.
 */
import { describe, expect, it } from 'vitest';

import { composeProfiles, validateInfra } from '../../../infra';

const COMPOSE = `services:
  postgres:
    image: pgvector/pgvector:pg16
    profiles:
      - postgres
    env_file:
      - ./.env

  redis:
    image: redis:7
    profiles:
      - redis

  # Local LLM runtime, for dev and test without cloud providers.
  ollama:
    image: ollama/ollama
    profiles:
      - ollama

volumes:
  pg_data:
`;

describe('the profiles a compose file defines', () => {
  it('reads every profile, sorted and de-duplicated', () => {
    expect(composeProfiles(COMPOSE)).toEqual(['ollama', 'postgres', 'redis']);
  });

  it('stops at the next key rather than swallowing the list under it', () => {
    expect(composeProfiles(COMPOSE)).not.toContain('./.env');
  });

  it('reads a quoted entry as its value', () => {
    expect(composeProfiles('    profiles:\n      - "billing"\n')).toEqual([
      'billing',
    ]);
  });

  it('reports none for a compose file that declares none', () => {
    expect(composeProfiles('services:\n  postgres:\n    image: pg\n')).toEqual(
      [],
    );
  });
});

describe('a declared profile', () => {
  const profiles = ['billing', 'ollama', 'postgres', 'redis'];

  it('passes when the compose file defines it', () => {
    expect(
      validateInfra('@acme/chat', { infra: ['postgres', 'ollama'] }, profiles),
    ).toEqual([]);
  });

  it('fails when it does not, naming the package and the profile', () => {
    const [error] = validateInfra(
      '@acme/chat',
      { infra: ['postgress'] },
      profiles,
    );

    expect(error).toContain('@acme/chat');
    expect(error).toContain('`postgress`');
    expect(error).toContain('deploy/compose.yaml');
    expect(error).toContain('postgres');
  });

  it('reports each unknown entry, keeping the known ones quiet', () => {
    const errors = validateInfra(
      '@acme/chat',
      { infra: ['postgres', 'jaegar', 'redis-cluster'] },
      profiles,
    );

    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('jaegar');
    expect(errors[1]).toContain('redis-cluster');
  });

  it('declaring nothing is not a violation — nothing is assumed on', () => {
    expect(validateInfra('@acme/ui', { testClass: 'none' }, profiles)).toEqual(
      [],
    );
    expect(validateInfra('@acme/ui', undefined, profiles)).toEqual([]);
  });

  it('fails a field that is not a list at all', () => {
    expect(
      validateInfra('@acme/chat', { infra: 'postgres' }, profiles)[0],
    ).toContain('must be an array');
  });

  it('fails an entry that is not a profile name', () => {
    expect(
      validateInfra(
        '@acme/chat',
        { infra: [{ name: 'postgres' }] },
        profiles,
      )[0],
    ).toContain('is not a profile name');
  });
});
