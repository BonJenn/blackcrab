import {View} from "react-native";
import {AppText as Text} from "./ui/AppText";
export function BrandMark(props:{readonly compact?:boolean;readonly stageLabel?:string}){return <View className="flex-row items-center gap-3"><Text accessibilityLabel="Blackcrab Remote" className="font-t3-bold" style={{fontSize:props.compact?22:30}}>Blackcrab</Text>{props.stageLabel?<Text>{props.stageLabel}</Text>:null}</View>;}
