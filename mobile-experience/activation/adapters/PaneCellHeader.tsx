import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";

/**
 * The bar of one pane in pane mode. Drawn in the pane itself rather than as a native navigation
 * bar, because several panes share one screen and only one native bar can exist.
 */
export function PaneCellHeader(props: {
  readonly title: string;
  readonly subtitle: string | null;
  readonly onMaximize: () => void;
  readonly onClose: () => void;
}) {
  return (
    <View className="h-12 flex-row items-center border-b border-border bg-screen pl-4">
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-t3-bold text-foreground" numberOfLines={1}>
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      <IconButton
        accessibilityLabel="Open thread full screen"
        icon="arrow.up.left.and.arrow.down.right"
        onPress={props.onMaximize}
      />
      <IconButton accessibilityLabel="Close pane" icon="xmark" onPress={props.onClose} />
    </View>
  );
}
