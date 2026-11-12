import { afterEach, expect, test, vi } from 'vitest';
import { EnvironmentId, ThreadId } from '../vendor/t3-mobile/packages/contracts/src/index.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

test('mobile copies and recognizes the same hosted thread/prompt links as desktop', async () => {
  vi.stubGlobal('__BLACKCRAB_HOSTED_APP_URL__', 'https://app.blackcrab.example');
  const threads = await import('../vendor/t3-mobile/packages/shared/src/threadLinks.ts');
  const prompts = await import('../vendor/t3-mobile/packages/shared/src/promptLinks.ts');
  const ref = { environmentId: EnvironmentId.make('environment-1'), threadId: ThreadId.make('thread-1') };
  const link = threads.hostedThreadLink(ref);
  expect(link).toBe('https://app.blackcrab.example/threads/environment-1/thread-1');
  expect(threads.parseThreadLinkHref(link)).toEqual(ref);
  expect(threads.hasThreadLinks(`[Thread](${link})`)).toBe(true);
  expect(threads.parseThreadLinkHref('https://app.t3.codes/threads/environment-1/thread-1')).toBeNull();
  expect(threads.parseThreadLinkHref(link.replace('.example/', '.example.evil/'))).toBeNull();
  const prompt = prompts.buildNewThreadLink({ prompt: 'Review the changes' });
  expect(prompt).toBe('https://app.blackcrab.example/new?prompt=Review+the+changes');
  expect(prompts.promptLinkAppPath(prompt)).toBe('/new?prompt=Review+the+changes');
  expect(prompts.promptLinkAppPath('blackcrab://new?prompt=Review')).toBe('/new?prompt=Review');
});

test('local-only mobile retains portable thread links and never selects an upstream hosted service', async () => {
  vi.stubGlobal('__BLACKCRAB_HOSTED_APP_URL__', '');
  const threads = await import('../vendor/t3-mobile/packages/shared/src/threadLinks.ts');
  const prompts = await import('../vendor/t3-mobile/packages/shared/src/promptLinks.ts');
  const ref = { environmentId: EnvironmentId.make('environment-1'), threadId: ThreadId.make('thread-1') };
  expect(threads.hostedThreadLink(ref)).toBe('t3-thread://v2/environment-1/thread-1');
  expect(threads.parseThreadLinkHref(threads.hostedThreadLink(ref))).toEqual(ref);
  expect(threads.parseThreadLinkHref('/threads/environment-1/thread-1')).toBeNull();
  expect(threads.hasThreadLinks('[Thread](/threads/environment-1/thread-1)')).toBe(false);
  expect(() => prompts.buildNewThreadLink({ prompt: 'Review' })).toThrow(/hosted/i);
});
