export const DEBUG_VS = `#version 300 es
in vec2 a_pos;
uniform mat4 u_matrix;
out vec2 v_local;
void main() {
  v_local = a_pos;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}
`;

export const DEBUG_FS = `#version 300 es
precision highp float;
in vec2 v_local;
uniform vec4 u_clip;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  if (any(lessThan(v_local, u_clip.xy)) || any(greaterThanEqual(v_local, u_clip.zw))) discard;
  fragColor = u_color;
}
`;
