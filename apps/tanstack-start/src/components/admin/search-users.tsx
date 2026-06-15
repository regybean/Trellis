import type React from 'react';
import { useState } from 'react';
import { Search, X } from 'lucide-react';

import { Button, Input, Label } from '@acme/ui';

interface SearchUsersProps {
  currentSearch: string;
  onSubmit: (query: string) => void;
  onClear: () => void;
}

/**
 * App-owned replacement for the Next-coupled `@acme/admin` `SearchUsers`
 * (which reads `next/navigation`). Navigation is lifted to the route via props
 * so this stays framework-neutral; parent keys it on `currentSearch` to reset
 * the input without an effect.
 */
export function SearchUsers({
  currentSearch,
  onSubmit,
  onClear,
}: SearchUsersProps) {
  const [searchTerm, setSearchTerm] = useState(currentSearch);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      onSubmit(searchTerm.trim());
    }
  };

  const handleClear = () => {
    setSearchTerm('');
    onClear();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="search" className="font-medium">
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
              className="pl-10"
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
          <Button type="submit" disabled={!searchTerm.trim()}>
            <Search className="mr-2 h-4 w-4" />
            Search
          </Button>
          {currentSearch && (
            <Button type="button" variant="outline" onClick={handleClear}>
              Clear
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
