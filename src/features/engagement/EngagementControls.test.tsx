import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { AuthProvider } from '../../app/providers/AuthProvider';
import { BridgeProvider } from '../../app/providers/BridgeProvider';
import { readEngagementCounts, sendTip } from '../../services/engagementService';
import { makeEnvironment } from '../../test/environment';
import { EngagementControls, TIP_FEEDBACK_DISMISS_MS } from './EngagementControls';
import type { EngagementItem } from './engagementItem';

const ACCOUNT = { address: 'QTestAccountAddress0000000000000000000000', publicKey: 'pk' };

vi.mock('../../app/providers/AuthProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/providers/AuthProvider')>();
  return {
    ...actual,
    useAuth: () => ({
      permission: 'granted' as const,
      account: ACCOUNT,
      ownedNames: [{ name: 'Reader Name', owner: ACCOUNT.address }],
      ownsPublisherName: true,
      ownsAnyName: true,
      ownershipResolved: true,
      authenticate: vi.fn(async () => {}),
      cancel: vi.fn(),
      reset: vi.fn(),
    }),
  };
});

vi.mock('../../services/engagementService', () => ({
  setLike: vi.fn(),
  publishComment: vi.fn(),
  sendTip: vi.fn(),
  readEngagementCounts: vi.fn(async () => ({ likes: 0, comments: 0 })),
  readEngagementComments: vi.fn(async () => []),
}));

const ITEM: EngagementItem = {
  entityIdentifier: 'saw_post_abcdefghijkl',
  kind: 'post',
  title: 'Redaction notes',
  sharePath: '/blog/abcdefghijkl',
};

function renderControls() {
  return render(
    <BridgeProvider environment={makeEnvironment({ publisherName: 'Shadow Archives' })}>
      <AuthProvider initialAccount={ACCOUNT}>
        <EngagementControls item={ITEM} />
      </AuthProvider>
    </BridgeProvider>,
  );
}

async function submitTip() {
  fireEvent.click(screen.getByRole('button', { name: 'Tip' }));
  fireEvent.change(screen.getByLabelText('QORT amount'), { target: { value: '1' } });
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Tip' }));
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.mocked(sendTip).mockReset();
  vi.mocked(readEngagementCounts).mockResolvedValue({ likes: 0, comments: 0 });
});

describe('EngagementControls share link', () => {
  it('copies the canonical Qortal deep link, never the local node URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('qortal://APP/Shadow%20Archives/blog/abcdefghijkl'),
    );
    expect(writeText.mock.calls[0][0]).not.toMatch(/^https?:\/\//);
  });
});

describe('EngagementControls tip feedback', () => {
  it('dismisses the successful tip message after approximately two seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(sendTip).mockResolvedValue({
      kind: 'submitted',
      recipient: 'QOwner',
      amount: 1,
      signature: 'sig',
    });

    renderControls();
    await submitTip();

    expect(screen.getByText('1 QORT tip submitted for Hub approval.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(TIP_FEEDBACK_DISMISS_MS - 1);
    });
    expect(screen.getByText('1 QORT tip submitted for Hub approval.')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.queryByText('1 QORT tip submitted for Hub approval.')).not.toBeInTheDocument();
  });

  it('does not hide a failed tip outcome prematurely', async () => {
    vi.useFakeTimers();
    vi.mocked(sendTip).mockResolvedValue({
      kind: 'failed',
      message: 'The QORT tip could not be submitted.',
    });

    renderControls();
    await submitTip();

    expect(screen.getByText('The QORT tip could not be submitted.')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('The QORT tip could not be submitted.')).toBeInTheDocument();
  });
});
