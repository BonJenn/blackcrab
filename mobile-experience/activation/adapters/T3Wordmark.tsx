import type {ColorValue} from "react-native";
import {AppText as Text} from "./ui/AppText";
/** Export name retained for pinned callers; artwork and label belong to Blackcrab. */
export function T3Wordmark(props:{readonly height:number;readonly color?:ColorValue;readonly colorClassName?:string}){return <Text accessibilityLabel="Blackcrab" className={props.colorClassName} style={{fontSize:props.height*0.65,...(props.color===undefined?{}:{color:props.color})}}>Blackcrab</Text>;}
