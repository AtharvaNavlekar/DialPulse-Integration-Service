import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { usePreferences } from '../context/PreferencesContext.tsx';
import { useToast } from '../context/ToastContext.tsx';
import {
  AlertBanner,
  Button,
  Card,
  INPUT_BASE_CLASS,
  PageHeader,
  SegmentedControl,
} from './ui/Primitives.tsx';

export interface WorkspaceNotificationItem {
  id: number;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export function NotificationsView({
  onNotificationsChange,
}: {
  onNotificationsChange?: (items: WorkspaceNotificationItem[]) => void;
}) {
  const { apiFetch, session } = useAuth();
  const { formatTimestamp } = usePreferences();
  const { pushToast } = useToast();
  const [items, setItems] = useState<WorkspaceNotificationItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | 'all' | null>(null);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ notifications: WorkspaceNotificationItem[] }>(
        `/api/workspace/notifications?filter=${filter}`
      );
      setItems(res.notifications);
      if (filter === 'all') {
        onNotificationsChange?.(res.notifications);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load notifications.'
      );
    } finally {
      setLoading(false);
    }
  }, [apiFetch, filter, onNotificationsChange]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications, session?.activeTenant.tenantId]);

  const handleMarkRead = async (notificationId?: number) => {
    setBusyId(notificationId ?? 'all');
    try {
      const res = await apiFetch<{ notifications: WorkspaceNotificationItem[] }>(
        '/api/workspace/notifications/mark-read',
        {
          method: 'POST',
          body: JSON.stringify(notificationId ? { notificationId } : {}),
        }
      );
      const next =
        filter === 'unread'
          ? res.notifications.filter((item) => !item.read)
          : res.notifications;
      setItems(next);
      onNotificationsChange?.(res.notifications);
      pushToast(
        notificationId ? 'Notification marked as read.' : 'All notifications marked as read.',
        'info'
      );
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Unable to update notification.',
        'error'
      );
    } finally {
      setBusyId(null);
    }
  };

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.message.toLowerCase().includes(q)
    );
  }, [items, search]);

  const unreadCount = useMemo(
    () => items.filter((n) => !n.read).length,
    [items]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications Center"
        description={`Internal workflow alerts and assignment notices for ${session?.activeTenant.tenantName ?? 'active tenant'}.`}
        actions={
          unreadCount > 0 ? (
            <Button
              variant="secondary"
              onClick={() => void handleMarkRead()}
              disabled={busyId === 'all'}
            >
              <CheckCheck className="w-4 h-4" aria-hidden="true" />
              {busyId === 'all' ? 'Updating...' : 'Mark All Read'}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <SegmentedControl
          options={[
            { value: 'all', label: 'All Notifications' },
            { value: 'unread', label: 'Unread Only' },
          ]}
          value={filter}
          onChange={setFilter}
        />

        <input
          type="search"
          aria-label="Filter notifications"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notifications..."
          className={`${INPUT_BASE_CLASS} w-full sm:w-72 py-1.5 text-[13px]`}
        />
      </div>

      {error && <AlertBanner tone="error" message={error} />}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-8 text-[13px] text-[var(--dp-on-surface-variant)]">
            Loading notifications...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Bell
              className="w-6 h-6 mx-auto text-[var(--dp-outline)]"
              aria-hidden="true"
            />
            <p className="text-[14px] font-medium text-[var(--dp-on-surface)]">
              {filter === 'unread'
                ? 'No unread notifications'
                : 'No notifications recorded yet'}
            </p>
            <p className="text-[12px] text-[var(--dp-on-surface-variant)]">
              Active Automation Lite workflows create internal notifications here when enquiries arrive.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--dp-outline-variant)]">
            {filteredItems.map((notif) => (
              <div
                key={notif.id}
                className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors duration-150 ${
                  notif.read ? 'bg-transparent' : 'bg-[var(--dp-primary-container)]/30'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--dp-on-surface)]">
                      {notif.title}
                    </span>
                    <span className="text-[11px] font-medium text-[var(--dp-on-surface-variant)]">
                      · {notif.read ? 'Read' : 'Unread'}
                    </span>
                  </div>
                  <p className="text-[13px] text-[var(--dp-on-surface-variant)] leading-relaxed">
                    {notif.message}
                  </p>
                  <div className="font-mono text-[11px] text-[var(--dp-outline)] tabular-nums">
                    {formatTimestamp(notif.createdAt)}
                  </div>
                </div>

                {!notif.read && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleMarkRead(notif.id)}
                    disabled={busyId === notif.id}
                    className="shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    Mark read
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
