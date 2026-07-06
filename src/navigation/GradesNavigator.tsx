// GradesNavigator — nested stack inside the Grades drawer item.
//
// The web Grades section has 8 sub-pages (overview, GPA simulator, transcript,
// report card, progress report, attendance, schedule, contact teachers), all
// pushed on top of the hub. The navigator is separate from the drawer entry so
// the drawer item does not need to know about sub-routes.

import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import GradesScreen from '../screens/GradesScreen'
import ClassworkScreen from '../screens/grades/ClassworkScreen'
import ReportCardScreen from '../screens/grades/ReportCardScreen'
import ScheduleScreen from '../screens/grades/ScheduleScreen'
import GpaSimulatorScreen from '../screens/grades/GpaSimulatorScreen'
import ContactTeachersScreen from '../screens/grades/ContactTeachersScreen'
import ProgressReportScreen from '../screens/grades/ProgressReportScreen'
import TranscriptScreen from '../screens/grades/TranscriptScreen'
import AttendanceScreen from '../screens/grades/AttendanceScreen'
import { useTheme } from '../theme/ThemeContext'

export type GradesStackParamList = {
  GradesHub: undefined
  Classwork: undefined
  ReportCard: undefined
  Schedule: undefined
  GpaSimulator: undefined
  ContactTeachers: undefined
  ProgressReport: undefined
  Transcript: undefined
  Attendance: undefined
}

const Stack = createNativeStackNavigator<GradesStackParamList>()

export default function GradesNavigator(): React.JSX.Element {
  const { theme } = useTheme()

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle:  { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontWeight: '600', fontSize: 17 },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="GradesHub"
        component={GradesScreen}
        options={{ title: 'Grades', headerShown: false }}
      />
      <Stack.Screen name="Classwork" component={ClassworkScreen} options={{ title: 'Classwork' }} />
      <Stack.Screen name="ReportCard" component={ReportCardScreen} options={{ title: 'Report Card' }} />
      <Stack.Screen name="Schedule" component={ScheduleScreen} options={{ title: 'Class Schedule' }} />
      <Stack.Screen name="GpaSimulator" component={GpaSimulatorScreen} options={{ title: 'What-If Calculator' }} />
      <Stack.Screen name="ContactTeachers" component={ContactTeachersScreen} options={{ title: 'Contact Teachers' }} />
      <Stack.Screen name="ProgressReport" component={ProgressReportScreen} options={{ title: 'Progress Report' }} />
      <Stack.Screen name="Transcript" component={TranscriptScreen} options={{ title: 'Transcript' }} />
      <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: 'Attendance' }} />
    </Stack.Navigator>
  )
}
