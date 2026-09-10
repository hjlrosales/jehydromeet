'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { SocketEvents } from '@jehydro/shared-types';
import type { Poll, PollClosedPayload, PollCreatedPayload, PollStatePayload, PollVotedPayload } from '@jehydro/shared-types';

interface PollsPanelProps {
  socket: Socket | null;
  roomId: string;
  myUuid: string;
  isHost: boolean;
  onClose: () => void;
}

// In-memory polls store per room (persists across panel open/close)
const pollsStore = new Map<string, Poll[]>();

function upsertPoll(roomId: string, poll: Poll): Poll[] {
  const existing = pollsStore.get(roomId) ?? [];
  const index = existing.findIndex((p) => p.id === poll.id);
  const updated = index === -1
    ? [...existing, poll]
    : existing.map((p) => (p.id === poll.id ? poll : p));
  pollsStore.set(roomId, updated);
  return updated;
}

export function PollsPanel({
  socket,
  roomId,
  myUuid,
  isHost,
  onClose,
}: PollsPanelProps) {
  const [polls, setPolls] = useState<Poll[]>(() => pollsStore.get(roomId) ?? []);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [optionsText, setOptionsText] = useState<string[]>(['', '']);
  const [sending, setSending] = useState(false);

  // -----------------------------------------------------------
  // Socket listeners for poll sync
  // -----------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onPollCreated = (payload: PollCreatedPayload) => {
      setPolls(upsertPoll(roomId, payload.poll));
    };

    const onPollVoted = (payload: PollVotedPayload) => {
      setPolls(upsertPoll(roomId, payload.poll));
    };

    const onPollClosed = (payload: PollClosedPayload) => {
      setPolls(upsertPoll(roomId, payload.poll));
    };

    const onPollState = (payload: PollStatePayload) => {
      pollsStore.set(roomId, payload.polls);
      setPolls(payload.polls);
    };

    socket.on(SocketEvents.POLL_CREATED, onPollCreated);
    socket.on(SocketEvents.POLL_VOTED, onPollVoted);
    socket.on(SocketEvents.POLL_CLOSED, onPollClosed);
    socket.on(SocketEvents.POLL_STATE, onPollState);

    // Request existing polls when mounting
    socket.emit(SocketEvents.POLL_STATE);

    return () => {
      socket.off(SocketEvents.POLL_CREATED, onPollCreated);
      socket.off(SocketEvents.POLL_VOTED, onPollVoted);
      socket.off(SocketEvents.POLL_CLOSED, onPollClosed);
      socket.off(SocketEvents.POLL_STATE, onPollState);
    };
  }, [socket, roomId]);

  // -----------------------------------------------------------
  // Create poll
  // -----------------------------------------------------------
  const handleCreatePoll = useCallback(async () => {
    if (!socket || sending) return;

    const trimmedQuestion = question.trim();
    const trimmedOptions = optionsText
      .map((o) => o.trim())
      .filter((o) => o.length > 0);

    if (!trimmedQuestion || trimmedOptions.length < 2) return;

    setSending(true);
    socket.emit(SocketEvents.POLL_CREATE, {
      question: trimmedQuestion,
      options: trimmedOptions,
    });
    // Delay reset so the "Creating..." text is visible
    setTimeout(() => {
      setSending(false);
      setShowCreateForm(false);
      setQuestion('');
      setOptionsText(['', '']);
    }, 300);
  }, [socket, sending, question, optionsText]);

  // -----------------------------------------------------------
  // Vote
  // -----------------------------------------------------------
  const handleVote = useCallback(
    (pollId: string, optionId: string) => {
      socket?.emit(SocketEvents.POLL_VOTE, { pollId, optionId });
    },
    [socket]
  );

  // -----------------------------------------------------------
  // Close poll (host only)
  // -----------------------------------------------------------
  const handleClosePoll = useCallback(
    (pollId: string) => {
      socket?.emit(SocketEvents.POLL_CLOSE, { pollId });
    },
    [socket]
  );

  // -----------------------------------------------------------
  // Add / remove option inputs in create form
  // -----------------------------------------------------------
  const addOption = useCallback(() => {
    setOptionsText((prev) => [...prev, '']);
  }, []);

  const removeOption = useCallback((index: number) => {
    setOptionsText((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const updateOption = useCallback((index: number, value: string) => {
    setOptionsText((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  }, []);

  // -----------------------------------------------------------
  // Check if current user already voted on a poll
  // -----------------------------------------------------------
  const hasVoted = (poll: Poll): boolean => {
    return poll.options.some((opt) => opt.votes.includes(myUuid));
  };

  // -----------------------------------------------------------
  // Get total vote count for a poll
  // -----------------------------------------------------------
  const totalVotes = (poll: Poll): number => {
    return poll.options.reduce((sum, opt) => sum + opt.votes.length, 0);
  };

  // -----------------------------------------------------------
  // Calculate percentage
  // -----------------------------------------------------------
  const votePercent = (votes: number, total: number): number => {
    if (total === 0) return 0;
    return Math.round((votes / total) * 100);
  };

  // -----------------------------------------------------------
  // Download results as JSON
  // -----------------------------------------------------------
  const downloadPollJSON = useCallback((poll: Poll) => {
    const data = {
      question: poll.question,
      createdBy: poll.createdBy,
      createdAt: new Date(poll.createdAt).toISOString(),
      closedAt: poll.closedAt ? new Date(poll.closedAt).toISOString() : null,
      status: poll.status,
      totalVotes: poll.options.reduce((sum, opt) => sum + opt.votes.length, 0),
      options: poll.options.map((opt) => ({
        text: opt.text,
        votes: opt.votes.length,
        voters: opt.votes,
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poll-${poll.id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // -----------------------------------------------------------
  // Download results as CSV
  // -----------------------------------------------------------
  const downloadPollCSV = useCallback((poll: Poll) => {
    const total = poll.options.reduce((sum, opt) => sum + opt.votes.length, 0);
    const header = 'Option,Votes,Percentage';
    const rows = poll.options.map((opt) => {
      const pct = total === 0 ? 0 : Math.round((opt.votes.length / total) * 100);
      return `"${opt.text.replace(/"/g, '""')}",${opt.votes.length},${pct}%`;
    });
    const csv = `"Poll Results: ${poll.question.replace(/"/g, '""')}"\n\n${header}\n${rows.join('\n')}\n\nTotal Votes,${total},100%`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poll-${poll.id.slice(0, 8)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-slate-900/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h2 className="text-lg font-semibold text-white">Polls</h2>
        <div className="flex items-center gap-2">
          {isHost && (
            <button
              type="button"
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500"
            >
              {showCreateForm ? 'Cancel' : 'Create Poll'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-600 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>

      {/* Create poll form */}
      {showCreateForm && (
        <div className="border-b border-slate-700 px-4 py-4">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">
                Question
              </label>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question..."
                maxLength={500}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">
                Options ({optionsText.filter((o) => o.trim()).length}/10)
              </label>
              <div className="space-y-2">
                {optionsText.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      maxLength={200}
                      className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                    {optionsText.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeOption(i)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-red-400"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {optionsText.length < 10 && (
                <button
                  type="button"
                  onClick={addOption}
                  className="mt-2 text-sm text-violet-400 hover:text-violet-300"
                >
                  + Add option
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleCreatePoll}
              disabled={
                sending ||
                !question.trim() ||
                optionsText.filter((o) => o.trim()).length < 2
              }
              className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? 'Creating...' : 'Launch Poll'}
            </button>
          </div>
        </div>
      )}

      {/* Polls list */}
      <div className="flex-1 overflow-y-auto p-4">
        {polls.length === 0 && !showCreateForm && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-slate-500">
              No polls yet. {isHost ? 'Click "Create Poll" to start one.' : 'Wait for the host to create a poll.'}
            </p>
          </div>
        )}

        <div className="space-y-4">
          {polls.map((poll) => {
            const total = totalVotes(poll);
            const voted = hasVoted(poll);
            const isClosed = poll.status === 'closed';

            return (
              <div
                key={poll.id}
                className={`rounded-xl border p-4 ${
                  isClosed
                    ? 'border-slate-600/50 bg-slate-800/50'
                    : 'border-slate-600 bg-slate-800'
                }`}
              >
                {/* Poll header */}
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{poll.question}</h3>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {isClosed ? 'Closed' : `${total} vote${total === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  {isHost && !isClosed && (
                    <button
                      type="button"
                      onClick={() => handleClosePoll(poll.id)}
                      className="rounded-lg bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-600 hover:text-white"
                    >
                      Close
                    </button>
                  )}
                </div>

                {/* Options */}
                <div className="space-y-2">
                  {poll.options.map((option) => {
                    const pct = votePercent(option.votes.length, total);

                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          if (!isClosed && !voted) handleVote(poll.id, option.id);
                        }}
                        disabled={isClosed || voted}
                        className={`relative w-full overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-all ${
                          isClosed || voted
                            ? 'border-slate-600/50 cursor-default'
                            : 'border-slate-600 hover:border-violet-500 hover:bg-slate-700/50 cursor-pointer'
                        } ${option.votes.includes(myUuid) ? 'border-violet-500 bg-violet-600/10' : 'bg-slate-800/50'}`}
                      >
                        {/* Progress bar */}
                        <div
                          className={`absolute inset-0 transition-all ${
                            option.votes.includes(myUuid)
                              ? 'bg-violet-600/15'
                              : 'bg-slate-700/30'
                          }`}
                          style={{ width: `${pct}%` }}
                        />

                        {/* Text and count */}
                        <div className="relative flex items-center justify-between">
                          <span className="text-sm text-slate-200">{option.text}</span>
                          <span className="ml-2 text-xs font-medium text-slate-400">
                            {option.votes.length} ({pct}%)
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Voted indicator */}
                {voted && !isClosed && (
                  <p className="mt-2 text-xs text-violet-400">You voted</p>
                )}

                {/* Closed results summary */}
                {isClosed && (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-lg bg-slate-700/30 px-3 py-2">
                      <p className="text-xs text-slate-400">
                        Final: {total} vote{total === 1 ? '' : 's'} —{' '}
                        {poll.options
                          .filter((opt) => opt.votes.length > 0)
                          .sort((a, b) => b.votes.length - a.votes.length)
                          .slice(0, 3)
                          .map((opt) => `${opt.text} (${opt.votes.length})`)
                          .join(', ') || 'No votes'}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => downloadPollJSON(poll)}
                        className="rounded-lg bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-600 hover:text-white"
                        title="Download results as JSON"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mr-1 inline h-3.5 w-3.5">
                          <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                          <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                        </svg>
                        JSON
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadPollCSV(poll)}
                        className="rounded-lg bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-600 hover:text-white"
                        title="Download results as CSV"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mr-1 inline h-3.5 w-3.5">
                          <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                          <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                        </svg>
                        CSV
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
