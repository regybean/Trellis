'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';

import { cn } from '../../src/lib/utils';
import { Button } from '../ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card';
import { Input } from '../ui/input';

interface SearchBarProps {
  onSearch: (searchTerm: string) => void;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchBar({
  onSearch,
  className,
  inputClassName,
  buttonClassName,
  placeholder = 'Search by keyword or category...',
  autoFocus = false,
}: SearchBarProps) {
  const [searchInput, setSearchInput] = useState('');

  const handleSearch = () => {
    onSearch(searchInput.trim());
  };

  return (
    <Card className="h-full gap-0 overflow-hidden pt-0 shadow-md">
      <div className="bg-primary h-2" />
      <CardHeader className="bg-accent p-0">
        <div className="px-6 py-4">
          <CardTitle className="text-text flex items-center">
            <Search className="text-text-accent mr-2 h-5 w-5" />
            Search Questions
          </CardTitle>
          <CardDescription className="text-text-secondary">
            Find specific compliance questions
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className={cn('w-full', className)}>
          <div className="relative">
            <Input
              type="text"
              placeholder={placeholder}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
              }}
              autoFocus={autoFocus}
              className={cn(
                'border-border text-text bg-background h-12 w-full pr-24 text-base',
                inputClassName,
              )}
              data-testid="search-bar-input"
            />
            <Button
              onClick={handleSearch}
              type="button"
              className={cn(
                'bg-primary text-on-primary hover:bg-button-primary-hover absolute top-1 right-1 flex h-10 items-center rounded-md px-4',
                buttonClassName,
              )}
              size="sm"
              data-testid="search-bar-button"
            >
              <Search className="mr-2 h-4 w-4" />
              Search
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
