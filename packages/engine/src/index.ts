import { requireNativeModule } from 'expo-modules-core';
import { EngineClient, parseEngineEvent, type EngineEvent, type Transport } from './protocol';
export * from './protocol';

type NativeEngine = {
  call(windowId: string, method: string, args: string): Promise<string>;
  addListener(name: 'browserEvent', listener: (event: { json: string }) => void): { remove(): void };
};

export function connectEngine(windowId: string): EngineClient {
  // A missing engine is an integration error, never a reason to invent browser state.
  const native = requireNativeModule<NativeEngine>('MerlinEngine');
  const transport: Transport = {
    call: (id, method, args) => native.call(id, method, args),
    subscribe: listener => {
      const subscription = native.addListener('browserEvent', event => {
        let parsed: EngineEvent;
        try { parsed = parseEngineEvent(event.json); }
        catch { parsed = { type: 'engine.error', windowId, message: 'The browser sent an invalid state update.' }; }
        listener(parsed);
      });
      return () => subscription.remove();
    },
  };
  return new EngineClient(windowId, transport);
}
