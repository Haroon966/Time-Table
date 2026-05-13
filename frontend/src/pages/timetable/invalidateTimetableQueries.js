/**
 * Central invalidation for timetable list + operational daily views after mutations.
 */
export function invalidateTimetableQueries(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['timetable'] });
  queryClient.invalidateQueries({ queryKey: ['timetable', 'daily'] });
  queryClient.invalidateQueries({ queryKey: ['timetable', 'conflicts'] });
}
