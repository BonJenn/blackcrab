import {test} from "node:test";
import assert from "node:assert/strict";
import {validOwnedServiceBrowser} from "./OwnedServiceBrowser.ts";
const socket={path:"/private/tmp/blackcrab-browser-"+"a".repeat(32)+"/b.sock",key:"b".repeat(64),generation:7};
test("native macOS and Linux socket capabilities retain exact private shape",()=>{assert(validOwnedServiceBrowser(socket));assert(validOwnedServiceBrowser({...socket,path:socket.path.replace("/private/tmp/","/tmp/")}));assert(validOwnedServiceBrowser({...socket,generation:Number.MAX_SAFE_INTEGER}));});
test("browser metadata cannot add paths, FDs or host configuration",()=>{for(const value of [null,[],{}, {...socket,path:"/foreign/b.sock"},{...socket,path:socket.path+"\\n"},{...socket,key:"B".repeat(64)},{...socket,key:"a"},{...socket,generation:0},{...socket,generation:-1},{...socket,generation:1.5},{...socket,generation:Number.MAX_SAFE_INTEGER+1},{...socket,fd:5},{...socket,host:"0.0.0.0"},{...socket,port:4500}])assert.equal(validOwnedServiceBrowser(value),false);});
