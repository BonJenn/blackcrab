import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { QueueChange } from "@blackcrab/remote-protocol";
import type { MobileQueueClient, MobileQueueState } from "./client";

export function QueueControls({client,state,hostId,sessionId}: {client:MobileQueueClient;state:MobileQueueState;hostId:string;sessionId:string}) {
  const [expanded,setExpanded]=useState(false);
  const [editing,setEditing]=useState<{id:string;text:string;revision:number}|null>(null);
  const items=state.queue?.items ?? [];
  const disabled=!state.connected || state.busy || !!state.pending || state.needsRefresh || state.support!=="available";
  function change(change: QueueChange, revision=state.queue?.revision) {
    return revision!==undefined ? client.mutate(hostId,sessionId,revision,change) : Promise.resolve(false);
  }
  function move(index: number, direction: number) {
    const ids=items.map(item=>item.commandId);
    const target=index+direction;
    if(target<0 || target>=ids.length) return;
    [ids[index],ids[target]]=[ids[target],ids[index]];
    change({type:"reorder",commandIds:ids});
  }
  return <ScrollView style={styles.root} nestedScrollEnabled keyboardShouldPersistTaps="handled">
    <View style={styles.actions}>
      <Button label={`Queue (${items.length})`} disabled={false} onPress={()=>setExpanded(value=>!value)} expanded={expanded}/>
      <Button label="Refresh queue" disabled={!state.connected || state.busy} onPress={()=>client.refresh(hostId,sessionId)}/>
      {items.length>0 && <Button label={state.queue?.paused ? "Resume queue" : "Pause queue"} disabled={disabled} onPress={()=>change({type:state.queue?.paused ? "resume":"pause"})}/>}
    </View>
    {!state.loaded && <Text style={styles.hint}>Loading saved message…</Text>}
    {state.support==="unknown" && <Text style={styles.hint}>Checking host queue support…</Text>}
    {state.queue?.paused && items.length>0 && <Text style={styles.hint}>Queue paused. Review the conversation before resuming. Resume requires an idle session on the desktop.</Text>}
    {state.support==="available" && !state.queue && <Text style={styles.hint}>Open this session on the desktop to create its queue.</Text>}
    {state.error && <Text accessibilityRole="alert" style={styles.error}>{state.error}</Text>}
    {state.notice && <Text accessibilityLiveRegion="polite" style={styles.hint}>{state.notice}</Text>}
    {state.pending && <View>
      <Text style={styles.hint}>{state.busy ? "Confirming saved message…" : "Message needs confirmation. Retry keeps the original command ID."}</Text>
      <Text selectable numberOfLines={4} style={styles.body}>{state.pending.body}</Text>
      <Button label="Retry saved message" disabled={!state.connected || state.busy || state.needsRefresh || state.support!=="available"} onPress={()=>client.retry(hostId,sessionId)}/>
    </View>}
    {expanded && <ScrollView style={styles.list} nestedScrollEnabled>
      {items.map((item,index)=><View key={item.commandId} style={styles.item}>
        {editing?.id===item.commandId ? <>
          <TextInput accessibilityLabel="Edit queued message" multiline value={editing.text} editable={!disabled} style={styles.editor} onChangeText={text=>setEditing({...editing,text})}/>
          {editing.revision!==state.queue?.revision && <Text style={styles.hint}>Queue changed. Cancel this edit and reopen the latest message.</Text>}
          <View style={styles.actions}>
            <Button label="Save message" disabled={disabled || !editing.text.trim() || editing.revision!==state.queue?.revision} onPress={()=>{void change({type:"edit",commandId:item.commandId,text:editing.text},editing.revision).then(saved=>{if(saved) setEditing(null);});}}/>
            <Button label="Cancel edit" disabled={state.busy} onPress={()=>setEditing(null)}/>
          </View>
        </> : <>
          <Text selectable style={styles.body}>{item.text}</Text>
          <View style={styles.actions}>
            <Button label={`Edit message ${index+1}`} disabled={disabled} onPress={()=>setEditing({id:item.commandId,text:item.text,revision:state.queue!.revision})}/>
            <Button label={`Move message ${index+1} up`} disabled={disabled || index===0} onPress={()=>move(index,-1)}/>
            <Button label={`Move message ${index+1} down`} disabled={disabled || index===items.length-1} onPress={()=>move(index,1)}/>
            <Button label={`Remove message ${index+1}`} disabled={disabled} onPress={()=>change({type:"cancel",commandId:item.commandId})}/>
          </View>
        </>}
      </View>)}
    </ScrollView>}
  </ScrollView>;
}
function Button({label,disabled,onPress,expanded}: {label:string;disabled:boolean;onPress:()=>void;expanded?:boolean}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled,expanded}} disabled={disabled} onPress={onPress} style={[styles.button,disabled && styles.disabled]}><Text style={styles.label}>{label}</Text></Pressable>;
}
const styles=StyleSheet.create({
  root:{borderTopWidth:1,borderColor:"#242a31",paddingTop:6,maxHeight:300},
  actions:{flexDirection:"row",flexWrap:"wrap",gap:6},
  button:{paddingHorizontal:8,paddingVertical:8,borderRadius:6,backgroundColor:"#242a31"},
  label:{color:"#f4f6f8",fontSize:12},disabled:{opacity:0.4},
  body:{color:"#f4f6f8",fontSize:13,paddingVertical:6},
  hint:{color:"#9aa3ad",fontSize:12,paddingVertical:4},error:{color:"#e0896f",fontSize:12,paddingVertical:4},
  list:{maxHeight:150},item:{paddingVertical:6,borderBottomWidth:1,borderColor:"#242a31"},
  editor:{color:"#f4f6f8",backgroundColor:"#11151a",padding:8,minHeight:60,maxHeight:100},
});
