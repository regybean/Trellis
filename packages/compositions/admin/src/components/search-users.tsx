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
        <Label htmlFor="search" className="text-foreground font-medium">
          Search Users
        </Label>
        <div className="flex space-x-2">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              id="search"
              name="search"
              type="text"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-ring pl-10"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={handleClear}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            className="bg-primary text-on-primary hover:bg-primary/90"
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
              className="border-border text-foreground hover:bg-accent"
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </form>
  );
};
