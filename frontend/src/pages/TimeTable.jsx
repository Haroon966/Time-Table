import React from 'react';
import { useAuth } from '../context/AuthContext';
import TeacherTimeTablePage from './timetable/TeacherTimeTablePage';
import PrincipalTimeTableRedesign from './timetable/PrincipalTimeTableRedesign';

export default function TimeTable() {
  const { user } = useAuth();
  if (user?.role === 'Teacher') {
    return <TeacherTimeTablePage />;
  }
  return <PrincipalTimeTableRedesign />;
}
