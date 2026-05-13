import { useQuery } from '@tanstack/react-query';
import { timetableAPI } from '../../services/api';

/**
 * Single principal entries query: full week (no day filter) or one master weekday.
 */
export function usePrincipalTimetableEntries({ timeScope, masterDayParam }) {
  return useQuery({
    queryKey: ['timetable', 'principal', timeScope === 'week' ? 'all' : masterDayParam],
    queryFn: async () => {
      if (timeScope === 'week') {
        const response = await timetableAPI.getAll();
        const data = response.data;
        return Array.isArray(data) ? data : (data?.results ?? []);
      }
      if (!masterDayParam) return [];
      const response = await timetableAPI.getAll({ day: masterDayParam });
      const data = response.data;
      return Array.isArray(data) ? data : (data?.results ?? []);
    },
    enabled: timeScope === 'week' || !!masterDayParam,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
