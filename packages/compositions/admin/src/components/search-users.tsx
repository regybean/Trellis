'use client';

import type React from 'react';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

import { Button, Input, Label } from '@acme/ui';

export const SearchUsers = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.get('search') ?? '';
  const [searchTerm, setSearchTerm] = useState(currentSearch);

  // Update the search term when the URL changes
  useEffect(() => {
    setSearchTerm(currentSearch);
  }, [currentSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      router.push(
        pathname + '?search=' + encodeURIComponent(searchTerm.trim()),
      );
    }
  };

  const handleClear = () => {
    setSearchTerm('');
    router.push(pathname);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="search" className="text-text font-medium">
          Search Users
        </Label>
        <div className="flex space-x-2">
          <div className="relative flex-1">
            <Search className="text-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              id="search"
              name="search"
              type="text"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="border-border bg-background text-text placeholder:text-text-secondary focus:border-border-accent focus:ring-border-accent pl-10"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={handleClear}
                className="text-text-secondary hover:text-text absolute top-1/2 right-3 -translate-y-1/2"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            className="bg-button-primary text-on-primary hover:bg-button-primary-hover"
            disabled={!searchTerm.trim()}
          >
            <Search className="mr-2 h-4 w-4" />
            Search
          </Button>
          {currentSearch && (
            <Button
              type="button"
              variant="outline"
              onClick={handleClear}
              className="border-border text-text hover:bg-background-hover"
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </form>
  );
};
