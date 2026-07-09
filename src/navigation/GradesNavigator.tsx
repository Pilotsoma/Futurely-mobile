import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import GradesScreen from '../screens/GradesScreen'
import AttendanceScreen from '../screens/grades/AttendanceScreen'
import ClassworkScreen from '../screens/grades/ClassworkScreen'
import ContactTeachersScreen from '../screens/grades/ContactTeachersScreen'
import GpaSimulatorScreen from '../screens/grades/GpaSimulatorScreen'
import ProgressReportScreen from '../screens/grades/ProgressReportScreen'
import ReportCardScreen from '../screens/grades/ReportCardScreen'
import ScheduleScreen from '../screens/grades/ScheduleScreen'
import TranscriptScreen from '../screens/grades/TranscriptScreen'
import { colors } from '../theme/tokens'

export type GradesStackParamList = {
  GradesHub: undefined
  Attendance: undefined
  Classwork: undefined
  ContactTeachers: undefined
  GpaSimulator: undefined
  ProgressReport: undefined
  ReportCard: undefined
  Schedule: undefined
  Transcript: undefined
}

const Stack = createNativeStackNavigator<GradesStackParamList>()

export default function GradesNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="GradesHub" component={GradesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: 'Attendance' }} />
      <Stack.Screen name="Classwork" component={ClassworkScreen} options={{ title: 'Classwork' }} />
      <Stack.Screen
        name="ContactTeachers"
        component={ContactTeachersScreen}
        options={{ title: 'Contact Teachers' }}
      />
      <Stack.Screen
        name="GpaSimulator"
        component={GpaSimulatorScreen}
        options={{ title: 'What-If Calculator' }}
      />
      <Stack.Screen
        name="ProgressReport"
        component={ProgressReportScreen}
        options={{ title: 'Progress Report' }}
      />
      <Stack.Screen name="ReportCard" component={ReportCardScreen} options={{ title: 'Report Card' }} />
      <Stack.Screen name="Schedule" component={ScheduleScreen} options={{ title: 'Schedule' }} />
      <Stack.Screen name="Transcript" component={TranscriptScreen} options={{ title: 'Transcript' }} />
    </Stack.Navigator>
  )
}
