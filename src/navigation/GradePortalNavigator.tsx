import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import GradePortalDashboard from '../screens/GradePortalDashboard'
import GradeViewerScreen from '../screens/GradeViewerScreen'
import TranscriptScreen from '../screens/TranscriptScreen'
import ClassScheduleScreen from '../screens/ClassScheduleScreen'
import ContactTeachersScreen from '../screens/ContactTeachersScreen'
import GpaSimulatorScreen from '../screens/GpaSimulatorScreen'
import PortalConnectScreen from '../screens/PortalConnectScreen'
import CourseDetailScreen from '../screens/CourseDetailScreen'

export type GradePortalParamList = {
  GradePortalHome: undefined
  GradeViewer: undefined
  CourseDetail: {
    courseId: string
    courseName: string
  }
  Transcript: undefined
  ClassSchedule: undefined
  ContactTeachers: undefined
  Simulator: undefined
  PortalConnect: undefined
}

const Stack = createNativeStackNavigator<GradePortalParamList>()

export default function GradePortalNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="GradePortalHome" component={GradePortalDashboard} />
      <Stack.Screen name="GradeViewer" component={GradeViewerScreen} />
      <Stack.Screen name="Transcript" component={TranscriptScreen} />
      <Stack.Screen name="ClassSchedule" component={ClassScheduleScreen} />
      <Stack.Screen name="ContactTeachers" component={ContactTeachersScreen} />
      <Stack.Screen name="Simulator" component={GpaSimulatorScreen} />
      <Stack.Screen name="PortalConnect" component={PortalConnectScreen} />
      <Stack.Screen name="CourseDetail" component={CourseDetailScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  )
}
