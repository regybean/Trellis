/**
 * The composer Source picker and "Sources included" — integration/components.
 *
 * Renders the REAL `<ChatAssistant>` driving the REAL `useSourceSelection`,
 * network faked at the HTTP boundary. No `vi.mock` of the hook or the tRPC
 * client.
 *
 * **Why this file must exist.** Wrong names here leak nothing — the retrieval
 * filter is server-built and would exclude an unowned Source however this
 * renders. What breaks instead is the user's belief about what their question
 * was exposed to, and that belief becomes false *and unverifiable*: there is no
 * other surface they can check it against. So the load-bearing assertions are
 * the two that pin where a name came from:
 *
 * 1. The disclosure renders the name from the per-Message RECEIPT even when
 *    `dataSources.list` offers a different one for the same id. That is
 *    invariant 11 made observable — the list is persisted, so a disclosure
 *    reading names from it could assert a scope off a day-old snapshot.
 * 2. It renders with `dataSources.list` never resolving at all, which is the
 *    cold open the receipt exists to survive.
 *
 * Everything else here is ordinary interaction cover for a control with two
 * jobs on one button (hover reads, click edits), where the failure mode is the
 * two jobs collapsing into one.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import '@testing-library/jest-dom';

import type { SelectDataSource } from '@acme/rag/schema';

import type { Message } from '../../../../api/schemas/message-schema';
import type { MessageSources } from '../../../../api/schemas/message-source-schema';
import { ChatAssistant } from '../../../../components/chat-assistant';
import { renderWithProviders, trpcMsw } from '../../setup';

// scrollIntoView / scrollTo are not implemented in jsdom.
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  value: vi.fn(),
  writable: true,
});
Object.defineProperty(globalThis, 'scrollTo', {
  value: vi.fn(),
  writable: true,
});

const SESSION_ID = '00000000-0000-4000-8000-000000000000';
const WORK = '11111111-1111-4111-8111-111111111111';
const TAX = '22222222-2222-4222-8222-222222222222';
const ASSISTANT_MESSAGE = 'assistant-message-1';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const source = (id: string, name: string): SelectDataSource => ({
  id,
  ownerId: 'user_test',
  name,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const WORK_SOURCE = source(WORK, 'Work notes');
const TAX_SOURCE = source(TAX, 'Tax');
const WORK_PICK = { id: WORK, name: 'Work notes' };
const TAX_PICK = { id: TAX, name: 'Tax' };

const receipt = (
  messageId: string,
  sources: { id: string; name: string }[],
): MessageSources => ({ messageId, sources });

// A settled exchange: the assistant Message carries a persisted id, which is
// what makes it eligible for a footer row at all
// (docs/adr/0007-message-actions-render-slot.md).
const transcript = (): Message[] => [
  {
    id: 'user-message-1',
    sessionId: SESSION_ID,
    role: 'user',
    text: 'What did I write about invoices?',
    timestamp: new Date(0),
  },
  {
    id: ASSISTANT_MESSAGE,
    sessionId: SESSION_ID,
    role: 'assistant',
    text: 'Here is what your notes say.',
    timestamp: new Date(0),
  },
];

/**
 * Every read a `<ChatAssistant>` mount makes, with the Source reads left to the
 * caller — they are what each case is about.
 */
const baseHandlers = () => [
  trpcMsw.chat.get.query(() => transcript()),
  trpcMsw.chat.inflightTurn.query(() => ({ turnId: null })),
  trpcMsw.chat.list.query(() => []),
  trpcMsw.chat.folders.list.query(() => []),
];

const sourceHandlers = ({
  list = [WORK_SOURCE, TAX_SOURCE],
  counts = [{ dataSourceId: WORK, documentCount: 4 }],
  records = [receipt(ASSISTANT_MESSAGE, [WORK_PICK, TAX_PICK])],
}: {
  list?: SelectDataSource[];
  counts?: { dataSourceId: string; documentCount: number }[];
  records?: MessageSources[];
} = {}) => [
  trpcMsw.chat.dataSources.list.query(() => list),
  trpcMsw.chat.dataSources.documentCounts.query(() => counts),
  trpcMsw.chat.dataSources.records.query(() => records),
];

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const mount = () =>
  renderWithProviders(<ChatAssistant sessionId={SESSION_ID} />);

// ── "Sources included" ───────────────────────────────────────────────────────
describe('"Sources included" reads the per-Message receipt', () => {
  it('renders the receipt’s names, not the ones the Source list offers', async () => {
    // The same two ids, under DIFFERENT names in the list — the shape a rename
    // produces, and what a persisted snapshot can look like generally. The
    // receipt is the one read that still states what the Turn was actually
    // scoped to, under the name it had then.
    server.use(
      ...baseHandlers(),
      ...sourceHandlers({
        list: [source(WORK, 'Renamed since'), source(TAX, 'Also renamed')],
        records: [receipt(ASSISTANT_MESSAGE, [WORK_PICK, TAX_PICK])],
      }),
    );
    const user = userEvent.setup();

    mount();

    const trigger = await screen.findByTestId('message-sources-trigger');
    expect(trigger).toHaveTextContent('2 sources included');

    await user.click(trigger);

    // Set equality over the rendered list, not "contains Work notes": a
    // contains-assertion passes just as happily against a list that also
    // rendered a name from the wrong source of truth.
    const list = screen.getByTestId('message-sources-list');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Work notes', 'Tax']);

    // And the names the list offered appear nowhere in the disclosure.
    expect(within(list).queryByText('Renamed since')).toBeNull();
  });

  it('renders on a cold open with the Source list never resolving', async () => {
    server.use(
      ...baseHandlers(),
      trpcMsw.chat.dataSources.records.query(() => [
        receipt(ASSISTANT_MESSAGE, [WORK_PICK]),
      ]),
      // Both list-shaped reads hang for the life of the test. If the disclosure
      // needed either of them it could only render a spinner or nothing.
      http.get(/chat\.dataSources\.list/, () => delay('infinite')),
      http.get(/chat\.dataSources\.documentCounts/, () => delay('infinite')),
    );
    const user = userEvent.setup();

    mount();

    const trigger = await screen.findByTestId('message-sources-trigger');
    await user.click(trigger);

    expect(
      within(screen.getByTestId('message-sources-list')).getByText(
        'Work notes',
      ),
    ).toBeInTheDocument();
  });

  it('discloses nothing for a Turn that recorded no Sources', async () => {
    server.use(
      ...baseHandlers(),
      ...sourceHandlers({ records: [receipt(ASSISTANT_MESSAGE, [])] }),
    );

    mount();

    // The empty receipt is a first-class value for STICKINESS, not a transcript
    // disclosure: an empty-scope Turn answers ungrounded and unexplained, with
    // the composer's amber pip as the signal before sending. A "0 sources
    // included" line here would be the wrong place to raise it.
    await waitFor(() =>
      expect(screen.getByTestId('bot-message')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('message-sources-trigger')).toBeNull();
  });

  it('keeps the list open once expanded, and leaves the row top-aligned', async () => {
    server.use(...baseHandlers(), ...sourceHandlers());
    const user = userEvent.setup();

    mount();

    const trigger = await screen.findByTestId('message-sources-trigger');

    // Hover alone must not expand — hover reveals the trigger, click opens it.
    await user.hover(trigger);
    expect(screen.queryByTestId('message-sources-list')).toBeNull();

    await user.click(trigger);
    expect(screen.getByTestId('message-sources-list')).toBeInTheDocument();

    // Moving the pointer away must not collapse it, or the list vanishes
    // mid-read. This is why `isExpanded` drops the hover-reveal classes rather
    // than the list being a hover affordance.
    await user.unhover(trigger);
    expect(screen.getByTestId('message-sources-list')).toBeInTheDocument();

    // jsdom runs no layout, so the avatar-slide this guards against cannot be
    // measured — the class contract IS the fix, and it is what is asserted, on
    // the avatar-and-bubble column specifically. Centred, expanding the list
    // re-centres that column and visibly slides the avatar down.
    const column = screen
      .getByTestId(`message-${ASSISTANT_MESSAGE}`)
      .querySelector(String.raw`.max-w-\[80\%\]`);
    expect(column?.className).toContain('items-start');
    expect(column?.className).not.toContain('items-center');
  });

  it('reveals the sources trigger on hover while the app’s actions stay put', async () => {
    server.use(...baseHandlers(), ...sourceHandlers());

    renderWithProviders(
      <ChatAssistant
        sessionId={SESSION_ID}
        // A stub, never `@acme/feedback` — a test reaching for the real
        // component would reintroduce the features→features dependency the
        // render slot exists to avoid
        // (docs/adr/0007-message-actions-render-slot.md).
        renderMessageActions={() => (
          <button type="button" data-testid="stub-action">
            Helpful
          </button>
        )}
      />,
    );

    const trigger = await screen.findByTestId('message-sources-trigger');
    const action = screen.getByTestId('stub-action');

    // They share one row beneath the bubble and do not compete: the actions are
    // always visible, the trigger is hover-revealed via the row's `group`.
    expect(action.parentElement).toBe(trigger.parentElement?.parentElement);
    expect(action.className).not.toContain('opacity-0');
    expect(trigger.className).toContain('opacity-0');
    expect(trigger.className).toContain('group-hover:opacity-100');
  });
});

// ── The composer button ──────────────────────────────────────────────────────
describe('the composer Source button', () => {
  it('lists the selected names in a tooltip without opening the panel', async () => {
    server.use(...baseHandlers(), ...sourceHandlers());
    const user = userEvent.setup();

    mount();

    // The selection restores from the latest receipt, so both Sources are
    // ticked before anything is clicked.
    const button = await screen.findByTestId('source-picker-button');
    await user.hover(button);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Data sources');
    expect(tooltip).toHaveTextContent('Work notes');
    expect(tooltip).toHaveTextContent('Tax');
    expect(tooltip).toHaveTextContent('Click to edit');

    // Reading the scope must never cost a panel open — that split is the whole
    // reason the tooltip exists beside a click target.
    expect(screen.queryByTestId('source-panel')).toBeNull();
  });

  it('carries no decoration when a scope is selected', async () => {
    server.use(...baseHandlers(), ...sourceHandlers());

    mount();

    const button = await screen.findByTestId('source-picker-button');
    await waitFor(() =>
      expect(screen.queryByTestId('source-empty-pip')).toBeNull(),
    );

    // No count on the button: `n of M selected` belongs in the panel header,
    // and a composer control that grows a badge per state is the chip rail this
    // design rejected.
    expect(button).not.toHaveTextContent(/\d/);
  });

  it('marks an empty scope in amber, in the tooltip and the panel header', async () => {
    server.use(
      ...baseHandlers(),
      // A settled Turn that recorded nothing — so the sticky selection restores
      // as empty, which is both the default and the state that means "retrieve
      // nothing".
      ...sourceHandlers({ records: [receipt(ASSISTANT_MESSAGE, [])] }),
    );
    const user = userEvent.setup();

    mount();

    const button = await screen.findByTestId('source-picker-button');
    expect(await screen.findByTestId('source-empty-pip')).toBeInTheDocument();

    await user.hover(button);
    const tooltip = await screen.findByRole('tooltip');
    const tooltipCopy = within(tooltip).getByText('No sources selected');
    expect(tooltipCopy.className).toContain('amber');

    await user.click(button);
    const scope = within(screen.getByTestId('source-panel')).getByTestId(
      'source-panel-scope',
    );
    expect(scope).toHaveTextContent('No sources selected');
    expect(scope.className).toContain('amber');
  });
});

// ── The panel ────────────────────────────────────────────────────────────────
describe('the Source panel', () => {
  it('opens on click with a row and count per Source, and the header count', async () => {
    server.use(
      ...baseHandlers(),
      ...sourceHandlers({
        counts: [
          { dataSourceId: WORK, documentCount: 4 },
          { dataSourceId: TAX, documentCount: 1 },
        ],
        records: [receipt(ASSISTANT_MESSAGE, [WORK_PICK])],
      }),
    );
    const user = userEvent.setup();

    mount();

    await user.click(await screen.findByTestId('source-picker-button'));
    const panel = screen.getByTestId('source-panel');

    await waitFor(() =>
      expect(within(panel).getByText('Work notes')).toBeInTheDocument(),
    );
    expect(within(panel).getByTestId('source-panel-scope')).toHaveTextContent(
      '1 of 2 selected',
    );

    const checkboxes = within(panel).getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(within(panel).getByText('4')).toBeInTheDocument();
  });

  it('ticks and unticks a Source, and clears the whole selection', async () => {
    server.use(
      ...baseHandlers(),
      ...sourceHandlers({ records: [receipt(ASSISTANT_MESSAGE, [WORK_PICK])] }),
    );
    const user = userEvent.setup();

    mount();

    await user.click(await screen.findByTestId('source-picker-button'));
    const panel = screen.getByTestId('source-panel');
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(2),
    );

    await user.click(within(panel).getByRole('checkbox', { name: /Tax/ }));
    expect(within(panel).getByTestId('source-panel-scope')).toHaveTextContent(
      '2 of 2 selected',
    );

    await user.click(within(panel).getByRole('button', { name: 'Clear' }));

    // Clearing has to carry forward as a CHOICE, which is why it lands as the
    // empty set rather than "untouched" — the pip is the observable proof it
    // did not snap back to the receipt.
    expect(within(panel).getByTestId('source-panel-scope')).toHaveTextContent(
      'No sources selected',
    );
    expect(screen.getByTestId('source-empty-pip')).toBeInTheDocument();
  });

  it('filters rows by name without touching the selection', async () => {
    server.use(
      ...baseHandlers(),
      ...sourceHandlers({ records: [receipt(ASSISTANT_MESSAGE, [WORK_PICK])] }),
    );
    const user = userEvent.setup();

    mount();

    await user.click(await screen.findByTestId('source-picker-button'));
    const panel = screen.getByTestId('source-panel');
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(2),
    );

    await user.type(within(panel).getByTestId('source-filter'), 'tax');

    expect(within(panel).queryByText('Work notes')).toBeNull();
    expect(within(panel).getByText('Tax')).toBeInTheDocument();

    // The filter hides rows; it does not untick them. `Work notes` is still in
    // the scope the next message will carry.
    expect(within(panel).getByTestId('source-panel-scope')).toHaveTextContent(
      '1 of 2 selected',
    );
  });

  it('stays editable while a Turn is in flight, and says when the edit lands', async () => {
    server.use(
      ...baseHandlers(),
      ...sourceHandlers({ records: [receipt(ASSISTANT_MESSAGE, [WORK_PICK])] }),
      // The send never resolves, so the Turn stays in flight for the whole
      // case. Letting it settle would make this a race against the reducer
      // walking back to idle, which is what the panel's note is NOT about.
      http.post(/chat\.send/, () => delay('infinite')),
    );
    const user = userEvent.setup();

    mount();

    await user.click(await screen.findByTestId('source-picker-button'));
    const panel = screen.getByTestId('source-panel');
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(2),
    );

    await user.type(screen.getByTestId('chat-input'), 'Another question');
    await user.click(screen.getByTestId('chat-send-button'));

    await waitFor(() =>
      expect(
        within(panel).getByText('applies from your next message'),
      ).toBeInTheDocument(),
    );

    // No lock. The user is reading a streaming answer and deciding what the
    // NEXT question should see, which is exactly when they want to change it —
    // so every row stays live and the tick takes effect.
    const tax = within(panel).getByRole('checkbox', { name: /Tax/ });
    expect(tax).toBeEnabled();
    await user.click(tax);
    expect(tax).toBeChecked();
  });

  it('offers the documents page when the user owns no Sources at all', async () => {
    server.use(
      ...baseHandlers(),
      ...sourceHandlers({ list: [], counts: [], records: [] }),
    );
    const user = userEvent.setup();

    mount();

    await user.click(await screen.findByTestId('source-picker-button'));
    const panel = screen.getByTestId('source-panel');

    await waitFor(() =>
      expect(
        within(panel).getByText(
          'You have no data sources yet. Answers will not use your documents.',
        ),
      ).toBeInTheDocument(),
    );

    // A link to the app's route, not an upload control: upload belongs to
    // `@acme/ingest`, and chat naming a sibling feature's component would be
    // the features→features edge the slice contract prevents.
    expect(
      within(panel).getByRole('link', { name: 'Upload documents' }),
    ).toHaveAttribute('href', '/documents');

    // Nothing to pick, so the picking half is absent rather than an empty list
    // with a filter above it.
    expect(within(panel).queryByTestId('source-filter')).toBeNull();
  });

  it('ticks a Source created inline from the panel', async () => {
    // The create lands in the same store `list` reads, so the invalidation the
    // mutation fires brings the new row back. Without that the reconciliation
    // would correctly untick it again — a Source the list does not report is
    // not one the user owns, which is the behaviour the hook test pins.
    const stored = [WORK_SOURCE];
    server.use(
      ...baseHandlers(),
      trpcMsw.chat.dataSources.list.query(() => stored),
      trpcMsw.chat.dataSources.documentCounts.query(() => []),
      trpcMsw.chat.dataSources.records.query(() => []),
      trpcMsw.chat.dataSources.create.mutation(({ input }) => {
        const row = source(input.id, input.name);
        stored.push(row);
        return row;
      }),
    );
    const user = userEvent.setup();

    mount();

    await user.click(await screen.findByTestId('source-picker-button'));
    const panel = screen.getByTestId('source-panel');
    await waitFor(() =>
      expect(within(panel).getAllByRole('checkbox')).toHaveLength(1),
    );

    await user.click(within(panel).getByTestId('source-create-open'));
    await user.type(within(panel).getByTestId('source-create-input'), 'Tax');
    await user.keyboard('{Enter}');

    // Ticked on arrival: the user opened the panel to change what the next
    // message is grounded in, so a Source landing unticked is a second click
    // for the thing they already asked for.
    await waitFor(() =>
      expect(within(panel).getByTestId('source-panel-scope')).toHaveTextContent(
        '1 of 2 selected',
      ),
    );
    expect(within(panel).getByText('Tax')).toBeInTheDocument();
  });
});
