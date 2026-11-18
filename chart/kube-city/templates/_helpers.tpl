{{- define "pn.name" -}}{{ .Release.Name }}{{- end -}}
{{- define "pn.labels" -}}
app.kubernetes.io/name: kube-city
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
{{- end -}}
{{- define "pn.selector" -}}
app.kubernetes.io/name: kube-city
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: game
{{- end -}}
{{- define "pn.redisUrl" -}}
{{- if .Values.redis.enabled -}}redis://{{ .Release.Name }}-redis:6379{{- else -}}{{ .Values.redis.url }}{{- end -}}
{{- end -}}
