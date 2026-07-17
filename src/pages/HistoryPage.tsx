import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { History, Download, Calendar, FileText } from 'lucide-react';
import { useCoverCache } from '../hooks/useCoverCache';

interface DownloadedBook {
  id: string;
  title: string;
  author?: string;
  year?: number;
  extension?: string;
  filesize?: number;
  downloaded_at?: string;
  cover?: string;
}

const HistoryPage: React.FC = () => {
  const [books, setBooks] = useState<DownloadedBook[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const { getCoverUrl } = useCoverCache();

  useEffect(() => {
    loadHistory();
  }, [page]);

  const loadHistory = async () => {
    setLoading(true);
    setError('');

    try {
      const result: any = await invoke('get_download_history', {
        order: 'date_down',
        page: page,
        limit: 20
      });

      if (result.books) {
        if (page === 1) {
          setBooks(result.books);
        } else {
          setBooks(prev => [...prev, ...result.books]);
        }
        setHasMore(result.books.length === 20);
      } else {
        setError('No download history found');
        setHasMore(false);
      }
    } catch (err: any) {
      console.error('Failed to load history:', err);
      setError(err.toString() || 'Failed to load download history. Please login first.');
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'Unknown';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Unknown date';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-surface border-b border-border p-6">
        <div className="flex items-center gap-3">
          <History className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Download History</h1>
            <p className="text-text-secondary mt-1">
              {books.length} {books.length === 1 ? 'book' : 'books'} downloaded
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && page === 1 && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
            <p className="mt-4 text-text-secondary">Loading history...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && books.length === 0 && (
          <div className="text-center py-12 text-text-secondary">
            <Download className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p className="text-lg">No download history yet</p>
            <p className="mt-2">Books you download will appear here</p>
          </div>
        )}

        {books.length > 0 && (
          <>
            <div className="space-y-4">
              {books.map((book) => (
                <div
                  key={`${book.id}-${book.downloaded_at}`}
                  className="bg-surface rounded-xl border border-border p-4 hover:border-primary/50 transition-all"
                >
                  <div className="flex gap-4">
                    {/* Cover */}
                    {(() => {
                      const coverUrl = getCoverUrl(book.id, book.cover);
                      return coverUrl ? (
                      <div className="w-24 h-32 bg-surface-light rounded-lg overflow-hidden flex-shrink-0">
                        <img
                          src={coverUrl}
                          alt={book.title}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement;
                            img.src = '';
                            img.style.visibility = 'hidden';
                          }}
                        />
                      </div>
                    ) : (
                      <div className="w-24 h-32 bg-surface-light rounded-lg flex items-center justify-center flex-shrink-0">
                        <FileText className="w-12 h-12 text-text-secondary opacity-30" />
                      </div>
                    );
                    })()}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg mb-1 line-clamp-2">
                        {book.title}
                      </h3>

                      {book.author && (
                        <p className="text-text-secondary mb-2 line-clamp-1">
                          {book.author}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
                        {book.downloaded_at && (
                          <div className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            <span>{formatDate(book.downloaded_at)}</span>
                          </div>
                        )}

                        {book.year && <span>📅 {book.year}</span>}

                        {book.extension && (
                          <span className="px-2 py-1 bg-primary/20 text-primary rounded uppercase text-xs font-medium">
                            {book.extension}
                          </span>
                        )}

                        {book.filesize && (
                          <span>💾 {formatFileSize(book.filesize)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Load More */}
            {hasMore && (
              <div className="mt-6 text-center">
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={loading}
                  className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default HistoryPage;
