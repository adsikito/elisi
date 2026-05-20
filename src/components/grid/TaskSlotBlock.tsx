import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { TaskNodeExtended } from '../../store/gridStore';

const PASTEL = {
  bg: '#D8D0E8',   // 低饱和淡紫灰
  text: '#6B6080',  // 柔和深紫文字
};

interface TaskSlotBlockProps {
  task: TaskNodeExtended;
  index: number;
  rowHeight: number;
  onPress?: (e: import('react-native').GestureResponderEvent) => void;
}

const TaskSlotBlock: React.FC<TaskSlotBlockProps> = ({ task, index, rowHeight, onPress }) => {
  const period = task.startPeriod || 1;
  const topOffset = (period - 1) * rowHeight + 4;

  return (
    <Pressable
      onPress={(e) => {
        e.stopPropagation();
        onPress?.(e);
      }}
      style={{
        position: 'absolute',
        top: topOffset,
        right: 4,
        width: '60%',
        height: rowHeight - 8,
        backgroundColor: PASTEL.bg,
        borderRadius: 8,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#B8B0C8',
        opacity: 0.85,
        paddingHorizontal: 6,
        paddingVertical: 4,
        justifyContent: 'center',
        zIndex: 5,
      }}
    >
      <Text
        style={{ fontSize: 10, fontWeight: '600', color: PASTEL.text }}
        numberOfLines={2}
      >
        {task.title}
      </Text>
    </Pressable>
  );
};

export default React.memo(TaskSlotBlock);
