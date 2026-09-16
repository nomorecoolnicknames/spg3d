import bpy, addon_utils
p = '/home/n8n/tools/blender_mcp_addon.py'
bpy.ops.preferences.addon_install(filepath=p, overwrite=True)
bpy.ops.preferences.addon_enable(module='blender_mcp_addon')
bpy.ops.wm.save_userpref()
bpy.context.scene.blendermcp_port = 9876
bpy.ops.blendermcp.start_server()
print('MCP_SERVER_STARTED', bpy.context.scene.blendermcp_server_running)
