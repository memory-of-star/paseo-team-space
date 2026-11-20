import type { ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

export function Button({
  theme,
  children,
  onPress,
  disabled = false,
  primary = false,
}: {
  theme: PluginTheme;
  children: ReactNode;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: primary ? theme.colors.accent : theme.colors.surface2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text
        style={{
          color: primary
            ? theme.colors.accentForeground
            : theme.colors.foreground,
          fontSize: 13,
          fontWeight: "600",
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}
export function Field({
  theme,
  label,
  value,
  onChange,
  secret = false,
  multiline = false,
}: {
  theme: PluginTheme;
  label: string;
  value: string;
  onChange(value: string): void;
  secret?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secret}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: 12,
          borderRadius: 8,
          minHeight: multiline ? 80 : 44,
          textAlignVertical: "top",
        }}
      />
    </View>
  );
}
export function ErrorText({
  theme,
  error,
}: {
  theme: PluginTheme;
  error: unknown;
}) {
  if (!error) return null;
  return (
    <Text
      accessibilityRole="alert"
      selectable
      style={{ color: theme.colors.statusDanger, fontSize: 13 }}
    >
      {error instanceof Error ? error.message : String(error)}
    </Text>
  );
}
