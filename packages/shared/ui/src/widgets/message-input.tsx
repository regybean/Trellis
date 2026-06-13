'use client';

import type React from 'react';
import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';

import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface MessageInputProps {
  onSend: (message: string) => void;
  /** true while awaiting a response */
  isLoading: boolean;
  placeholder?: string;
  inputTestId?: string;
  buttonTestId?: string;
  spinnerTestId?: string;
  className?: string;
}

export function MessageInput({
  onSend,
  isLoading,
  placeholder = 'Type your message...',
  inputTestId = 'message-input',
  buttonTestId = 'send-button',
  spinnerTestId = 'loading-spinner',
  className = '',
}: MessageInputProps) {
  const [value, setValue] = useState('');

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!isLoading) handleSend();
    }
  };

  return (
    <div className={`flex w-full items-center space-x-2 ${className}`}>
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        data-testid={inputTestId}
      />
      <Button
        onClick={handleSend}
        disabled={isLoading || value.trim() === ''}
        aria-label="Send message"
        data-testid={buttonTestId}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md"
      >
        {isLoading ? (
          <Loader2
            className="h-4 w-4 animate-spin"
            data-testid={spinnerTestId}
          />
        ) : (
          <Send className="text-primary-foreground h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
