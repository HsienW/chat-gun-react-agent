import { useEffect, useState } from 'react';
import {
  Activity,
  Brain,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Pen,
  Search,
  TextSearch,
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface ProcessedEvent {
  title: string;
  data: string | string[] | Record<string, unknown>;
}

interface ActivityTimelineProps {
  processedEvents: ProcessedEvent[];
  isLoading: boolean;
}

export function ActivityTimeline({
  processedEvents,
  isLoading,
}: ActivityTimelineProps) {
  const [isTimelineCollapsed, setIsTimelineCollapsed] =
    useState<boolean>(false);

  const getEventIcon = (title: string, index: number) => {
    const iconClass = 'h-4 w-4 text-[#E7D9C1]';
    const lowerTitle = title.toLowerCase();

    if (index === 0 && isLoading && processedEvents.length === 0) {
      return <Loader2 className={`${iconClass} animate-spin`} />;
    }
    if (lowerTitle.includes('generating') || lowerTitle.includes('query')) {
      return <TextSearch className={iconClass} />;
    }
    if (lowerTitle.includes('thinking')) {
      return <Loader2 className={`${iconClass} animate-spin`} />;
    }
    if (lowerTitle.includes('reflection')) {
      return <Brain className={iconClass} />;
    }
    if (lowerTitle.includes('research')) {
      return <Search className={iconClass} />;
    }
    if (lowerTitle.includes('finalizing') || lowerTitle.includes('final')) {
      return <Pen className={iconClass} />;
    }
    return <Activity className={iconClass} />;
  };

  useEffect(() => {
    if (!isLoading && processedEvents.length !== 0) {
      setIsTimelineCollapsed(true);
    }
  }, [isLoading, processedEvents]);

  return (
    <Card className="border border-border rounded-lg bg-card max-h-96 w-full min-w-0">
      <CardHeader>
        <CardDescription className="flex items-center justify-between min-w-0">
          <button
            type="button"
            className="flex items-center justify-start text-sm w-full cursor-pointer gap-2 text-[#F8F1E7] min-w-0 truncate"
            onClick={() => setIsTimelineCollapsed(!isTimelineCollapsed)}
          >
            Research
            {isTimelineCollapsed ? (
              <ChevronDown className="h-4 w-4 mr-2 flex-shrink-0" />
            ) : (
              <ChevronUp className="h-4 w-4 mr-2 flex-shrink-0" />
            )}
          </button>
        </CardDescription>
      </CardHeader>
      {!isTimelineCollapsed && (
        <ScrollArea className="max-h-96 overflow-y-auto">
          <CardContent>
            {isLoading && processedEvents.length === 0 && (
              <div className="relative pl-8 pb-4 min-w-0">
                <div className="absolute left-3 top-3.5 h-full w-0.5 bg-[#5A4036]" />
                <div className="absolute left-0.5 top-2 h-5 w-5 rounded-full bg-[#7A1E1E] flex items-center justify-center ring-4 ring-card">
                  <Loader2 className="h-3 w-3 text-[#E7D9C1] animate-spin" />
                </div>
                <p className="text-sm text-[#E7D9C1] font-medium truncate">
                  研究中...
                </p>
              </div>
            )}

            {processedEvents.length > 0 ? (
              <div className="space-y-0 min-w-0">
                {processedEvents.map((eventItem, index) => (
                  <div key={index} className="relative pl-8 pb-4 min-w-0">
                    {index < processedEvents.length - 1 ||
                    (isLoading && index === processedEvents.length - 1) ? (
                      <div className="absolute left-3 top-3.5 h-full w-0.5 bg-[#5A4036]" />
                    ) : null}
                    <div className="absolute left-0.5 top-2 h-6 w-6 rounded-full bg-[#7A1E1E] flex items-center justify-center ring-4 ring-card">
                      {getEventIcon(eventItem.title, index)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-[#F8F1E7] font-medium mb-0.5 truncate">
                        {eventItem.title}
                      </p>
                      <p className="text-xs text-[#E7D9C1]/80 leading-relaxed break-words overflow-wrap-anywhere">
                        {typeof eventItem.data === 'string'
                          ? eventItem.data
                          : Array.isArray(eventItem.data)
                          ? eventItem.data.join(', ')
                          : JSON.stringify(eventItem.data)}
                      </p>
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="relative pl-8 pb-4 min-w-0">
                    <div className="absolute left-0.5 top-2 h-5 w-5 rounded-full bg-[#7A1E1E] flex items-center justify-center ring-4 ring-card">
                      <Loader2 className="h-3 w-3 text-[#E7D9C1] animate-spin" />
                    </div>
                    <p className="text-sm text-[#E7D9C1] font-medium truncate">
                      研究中...
                    </p>
                  </div>
                )}
              </div>
            ) : !isLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-[#E7D9C1]/50 pt-10 min-w-0">
                <Info className="h-6 w-6 mb-3 flex-shrink-0" />
                <p className="text-sm text-center">尚無研究事件</p>
                <p className="text-xs text-[#E7D9C1]/40 mt-1 text-center">
                  Timeline 會顯示 agent 的研究步驟。
                </p>
              </div>
            ) : null}
          </CardContent>
        </ScrollArea>
      )}
    </Card>
  );
}
